"""Минимальное чтение/запись PNG без Pillow (RGBA 8 бит)."""
import struct, zlib
def read(path):
    d=open(path,'rb').read(); assert d[:8]==b'\x89PNG\r\n\x1a\n'
    p=8; idat=b''; plte=None; trns=None
    while p<len(d):
        n,=struct.unpack('>I',d[p:p+4]); t=d[p+4:p+8]; c=d[p+8:p+8+n]; p+=12+n
        if t==b'IHDR': w,h,bd,ct,_,_,il=struct.unpack('>IIBBBBB',c)
        elif t==b'PLTE': plte=[tuple(c[i:i+3]) for i in range(0,len(c),3)]
        elif t==b'tRNS': trns=c
        elif t==b'IDAT': idat+=c
    raw=zlib.decompress(idat); assert bd==8 and il==0, (bd,il)
    ch={6:4,2:3,3:1,4:2,0:1}[ct]; stride=w*ch; out=[]; prev=bytearray(stride); i=0
    for y in range(h):
        f=raw[i]; i+=1; line=bytearray(raw[i:i+stride]); i+=stride
        for x in range(stride):
            a=line[x-ch] if x>=ch else 0; b=prev[x]; cc=prev[x-ch] if x>=ch else 0
            if f==1: line[x]=(line[x]+a)&255
            elif f==2: line[x]=(line[x]+b)&255
            elif f==3: line[x]=(line[x]+(a+b)//2)&255
            elif f==4:
                pa=abs(b-cc); pb=abs(a-cc); pc=abs(a+b-2*cc)
                pr=a if pa<=pb and pa<=pc else (b if pb<=pc else cc); line[x]=(line[x]+pr)&255
        prev=line; row=[]
        for x in range(w):
            px=line[x*ch:(x+1)*ch]
            if ct==6: row.append(tuple(px))
            elif ct==2: row.append(tuple(px)+(255,))
            elif ct==3:
                k=px[0]; al=trns[k] if trns and k<len(trns) else 255; row.append(plte[k]+(al,))
            elif ct==4: row.append((px[0],px[0],px[0],px[1]))
            else: row.append((px[0],)*3+(255,))
        out.append(row)
    return out
def write(path,px):
    h=len(px); w=len(px[0]); raw=b''.join(b'\x00'+bytes(sum((list(p) for p in r),[])) for r in px)
    def chunk(t,c): return struct.pack('>I',len(c))+t+c+struct.pack('>I',zlib.crc32(t+c)&0xffffffff)
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))
