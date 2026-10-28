"""Мини-клиент RCON: ждёт сервер, выполняет команды по очереди, печатает ответы. Для test-server.sh."""
import socket, struct, sys, time


def packet(i, kind, body):
    data = struct.pack('<ii', i, kind) + body.encode() + b'\x00\x00'
    return struct.pack('<i', len(data)) + data


def recv(s):
    n = struct.unpack('<i', s.recv(4))[0]
    data = b''
    while len(data) < n:
        data += s.recv(n - len(data))
    return data[8:-2].decode(errors='replace')


def main(port, password, commands, alive=None):
    for _ in range(600):
        if alive and not alive():
            sys.exit('сервер упал при запуске — смотрите run/check.log')
        try:
            s = socket.create_connection(('127.0.0.1', port), timeout=5)
            break
        except OSError:
            time.sleep(1)
    else:
        sys.exit('сервер не поднялся')
    s.settimeout(120)
    s.sendall(packet(1, 3, password)); recv(s)
    for c in commands:
        if c.startswith('sleep '):
            time.sleep(float(c.split()[1])); continue
        s.sendall(packet(2, 2, c))
        try:
            print(f'> {c}\n{recv(s)}', flush=True)
        except (OSError, struct.error):
            print(f'> {c}\n(соединение закрыто)', flush=True)
            break


if __name__ == '__main__':
    import os
    pid = int(os.environ.get('SERVER_PID', '0'))

    def alive():
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    main(int(sys.argv[1]), sys.argv[2], sys.argv[3:], alive if pid else None)
