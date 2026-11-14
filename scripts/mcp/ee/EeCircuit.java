// Прогон цепи Create: Electroenergetics вне игры на настоящих классах мода (инструмент MCP ee_circuit, dev #355).
//
// Элементы — классы EE из jar сборки: ElectricalProperties, InductorProperties, CapacitorProperties, DiodeProperties;
// решатели — CholeskySolver (без источников напряжения) и LUSolver (с ними), матрица — SparseMatrix. Сборка матрицы
// повторяет Network.formMatrix, порядок микрошага — SimulationTicker.tick: tick() всех микротикающих → formMatrix →
// решение → afterTick(). Сеть без земли получает 1000 См на один узел, как CircuitBuilder.dfsAndGround. Оптимизация
// топологии (последовательные резисторы, звезда→треугольник) не повторяется: на результат она не влияет, кроме округления.
//
// Запуск: java -cp <jar EE>:<fastutil>[:<Minecraft для диода>] EeCircuit.java < описание
// Вход (stdin) — строки «ключ=значение» параметров, затем «---», затем элементы по строке:
//   [имя:] ТИП a b [значение] [ключ=значение …]
// Типы: R (Ом), L (Гн; i0, r), C (Ф; v0, r), D (анод a, катод b), V (ЭДС, В, источник Тевенина; r, по умолчанию
// 1 Ом), E (идеальный источник напряжения, В), I (ток из a через источник в b, А). Источникам: sin=Гц, phase=градусы,
// offset=В|А, hold=tick (значение держится весь тик, как у блоков) вместо micro (своё на каждом микрошаге).
// Узел, названный в ground=…, получает проводимость на землю (по умолчанию 1000 См).
import com.george_vi.electroenergetics.foundation.electrical_properties.CapacitorProperties;
import com.george_vi.electroenergetics.foundation.electrical_properties.DiodeProperties;
import com.george_vi.electroenergetics.foundation.electrical_properties.InductorProperties;
import com.george_vi.electroenergetics.simulation.electrical_properties.ElectricalProperties;
import com.george_vi.electroenergetics.simulation.electrical_properties.MicroTickingElectricalProperties;
import com.george_vi.electroenergetics.simulation.util.CholeskySolver;
import com.george_vi.electroenergetics.simulation.util.LUSolver;
import com.george_vi.electroenergetics.simulation.util.SparseMatrix;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class EeCircuit {
  static final double TICK = 0.05;

  static class Fail extends RuntimeException {
    Fail(String m) {
      super(m);
    }
  }

  /** Ребро графа EE: свойства между узлами a и b (порядок — как в connect(a, b)). */
  static class Edge {
    String name, type, element;
    int a, b;
    ElectricalProperties p;
    // источник: амплитуда/постоянная, частота, фаза (рад), смещение, держать на тик
    double value, freq, phase, offset, rSrc = 1.0;
    boolean wave, holdTick;
    int vsIndex = -1; // строка MNA идеального источника
    double current; // ток a→b после решения микрошага
  }

  /** Наблюдаемая величина */
  static class Probe {
    String label, unit;
    java.util.function.DoubleSupplier get;
    double min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY, sum, sumSq, last, first = Double.NaN;
    long count;
    double prev = Double.NaN, prevT;
    List<Double> ups = new ArrayList<>();
    double[] samples;

    Probe(String label, String unit, java.util.function.DoubleSupplier get) {
      this.label = label;
      this.unit = unit;
      this.get = get;
    }
  }

  final Map<String, Integer> nodeIds = new LinkedHashMap<>();
  final List<String> nodeNames = new ArrayList<>();
  final List<Edge> edges = new ArrayList<>();
  final List<Edge> vsources = new ArrayList<>();
  final Map<String, Edge> byName = new LinkedHashMap<>();
  double[] ground;
  final List<String> notes = new ArrayList<>();

  int node(String name) {
    return nodeIds.computeIfAbsent(name, k -> {
      nodeNames.add(k);
      return nodeNames.size() - 1;
    });
  }

  static double num(String s, String what) {
    try {
      String t = s.trim().toLowerCase(Locale.ROOT).replace(',', '.');
      double mul = 1;
      // суффиксы СИ: 10k, 4.7u, 100m, 2meg
      if (t.endsWith("meg")) {
        mul = 1e6;
        t = t.substring(0, t.length() - 3);
      } else if (!t.isEmpty() && "pnumkMG".indexOf(s.trim().charAt(s.trim().length() - 1)) >= 0) {
        char c = s.trim().charAt(s.trim().length() - 1);
        mul = switch (c) {
          case 'p' -> 1e-12;
          case 'n' -> 1e-9;
          case 'u' -> 1e-6;
          case 'm' -> 1e-3;
          case 'k' -> 1e3;
          case 'M' -> 1e6;
          case 'G' -> 1e9;
          default -> 1;
        };
        t = t.substring(0, t.length() - 1);
      }
      return Double.parseDouble(t) * mul;
    } catch (NumberFormatException e) {
      throw new Fail("не число в «" + what + "»: " + s);
    }
  }

  static final Map<String, Integer> COUNTERS = new LinkedHashMap<>();

  Edge add(String name, String type, String element, int a, int b, ElectricalProperties p) {
    Edge e = new Edge();
    e.name = name;
    e.type = type;
    e.element = element;
    e.a = a;
    e.b = b;
    e.p = p;
    edges.add(e);
    return e;
  }

  void parseElement(String line, int lineNo) {
    String s = line.trim();
    String name = null;
    int colon = s.indexOf(':');
    if (colon > 0 && !s.substring(0, colon).contains(" ")) {
      name = s.substring(0, colon).trim();
      s = s.substring(colon + 1).trim();
    }
    String[] parts = s.split("\\s+");
    if (parts.length < 3) throw new Fail("строка " + lineNo + ": нужно «ТИП a b [значение]» — «" + line.trim() + "»");
    String type = parts[0].toUpperCase(Locale.ROOT);
    List<String> pos = new ArrayList<>();
    Map<String, String> kv = new LinkedHashMap<>();
    for (int i = 1; i < parts.length; i++) {
      int eq = parts[i].indexOf('=');
      if (eq > 0) kv.put(parts[i].substring(0, eq).toLowerCase(Locale.ROOT), parts[i].substring(eq + 1));
      else pos.add(parts[i]);
    }
    if (pos.size() < 2) throw new Fail("строка " + lineNo + ": не хватает узлов — «" + line.trim() + "»");
    String na = pos.get(0), nb = pos.get(1);
    if (na.equals(nb)) throw new Fail("строка " + lineNo + ": оба вывода на узле " + na);
    if (name == null) name = type + COUNTERS.merge(type, 1, Integer::sum);
    if (byName.containsKey(name)) throw new Fail("строка " + lineNo + ": имя " + name + " уже занято");
    boolean needValue = !type.equals("D");
    if (needValue && pos.size() < 3) throw new Fail("строка " + lineNo + ": нет значения у " + name);
    double v = needValue ? num(pos.get(2), name) : 0;
    int a = node(na), b = node(nb);
    for (String k : kv.keySet())
      if (!List.of("r", "i0", "v0", "sin", "phase", "offset", "hold").contains(k))
        throw new Fail("строка " + lineNo + ": неизвестный ключ «" + k + "» у " + name);
    Edge main;
    switch (type) {
      case "R" -> {
        if (!(v > 0)) throw new Fail(name + ": сопротивление должно быть > 0 (EE запрещает 0 Ом)");
        main = add(name, "R", name, a, b, ElectricalProperties.resistor(v));
      }
      case "L", "C" -> {
        double r = kv.containsKey("r") ? num(kv.get("r"), name + " r") : 0;
        int mid = b;
        if (r > 0) mid = node(name + ".вн");
        MicroTickingElectricalProperties p;
        if (type.equals("L")) {
          InductorProperties l = new InductorProperties();
          l.inductance = v;
          if (kv.containsKey("i0")) l.lastCurrent = num(kv.get("i0"), name + " i0");
          p = l;
        } else {
          CapacitorProperties c = new CapacitorProperties();
          c.capacitance = v;
          if (kv.containsKey("v0")) c.lastVoltage = num(kv.get("v0"), name + " v0");
          p = c;
        }
        // как InductorDevice/CapacitorDevice: connect(0, 2, свойства).resistor(1, 2, 0.1)
        main = add(name, type, name, a, mid, p);
        if (r > 0) add(name + ".r", "R", name, b, mid, ElectricalProperties.resistor(r));
      }
      case "D" -> main = add(name, "D", name, b, a, newDiode());
      case "V", "E", "I" -> {
        ElectricalProperties p;
        Edge e;
        if (type.equals("V")) {
          double r = kv.containsKey("r") ? num(kv.get("r"), name + " r") : 1.0;
          if (!(r > 0)) throw new Fail(name + ": внутреннее сопротивление должно быть > 0");
          p = new ElectricalProperties(r, 0.0, 0.0);
          // ток v/r втекает в узел a (rhs[b] += cs у ребра b→a): ЭДС a − b = v
          e = add(name, type, name, b, a, p);
          e.rSrc = r;
        } else if (type.equals("E")) {
          // как ElectricalProperties.INFINITE_CONDUCTANCE: проводимость 0, строка MNA; formMatrix: V(второй) − V(первый) = v
          p = new ElectricalProperties(1.0E11, 0.0, 0.0, true);
          e = add(name, type, name, b, a, p);
          e.vsIndex = vsources.size();
          vsources.add(e);
        } else {
          p = new ElectricalProperties(1.0E11, 0.0, 0.0);
          e = add(name, type, name, a, b, p);
        }
        e.value = v;
        if (kv.containsKey("sin")) {
          e.wave = true;
          e.freq = num(kv.get("sin"), name + " sin");
        }
        e.phase = kv.containsKey("phase") ? Math.toRadians(num(kv.get("phase"), name + " phase")) : 0;
        e.offset = kv.containsKey("offset") ? num(kv.get("offset"), name + " offset") : 0;
        String hold = kv.getOrDefault("hold", "micro");
        if (!hold.equals("micro") && !hold.equals("tick")) throw new Fail(name + ": hold — micro или tick");
        e.holdTick = hold.equals("tick");
        main = e;
      }
      default -> throw new Fail("строка " + lineNo + ": неизвестный тип «" + parts[0] + "» (R, L, C, D, V, E, I)");
    }
    main.name = name;
    byName.put(name, main);
  }

  static ElectricalProperties newDiode() {
    try {
      return new DiodeProperties();
    } catch (NoClassDefFoundError e) {
      throw new Fail("диоду EE нужен класс Minecraft net.minecraft.util.Mth — нет jar Minecraft (кеш NeoForge аддонов)");
    }
  }

  // ---------------------------------------------------------------- микрошаг

  double sourceValue(Edge e, long micro, int n, double dt) {
    double t = e.holdTick ? (micro / n) * TICK : micro * dt;
    return e.wave ? e.value * Math.sin(2 * Math.PI * e.freq * t + e.phase) + e.offset : e.value + e.offset;
  }

  /** Один микрошаг как SimulationTicker: tick → formMatrix → решение → afterTick. Возвращает напряжения узлов. */
  double[] step(double[] all, int micro, int n, long absMicro, double dt) {
    int nodes = nodeNames.size();
    for (Edge e : edges) {
      switch (e.type) {
        case "V" -> e.p.currentSource = sourceValue(e, absMicro, n, dt) / e.rSrc;
        case "I" -> e.p.currentSource = sourceValue(e, absMicro, n, dt);
        case "E" -> e.p.voltageSource = sourceValue(e, absMicro, n, dt);
        default -> {}
      }
    }
    for (Edge e : edges) if (e.p instanceof MicroTickingElectricalProperties m) m.tick(all, micro, n, e.a, e.b);
    int size = nodes + vsources.size();
    SparseMatrix m = new SparseMatrix(size);
    double[] diag = ground.clone();
    double[] rhs = new double[size];
    for (Edge e : edges) {
      double g = e.p.conductance();
      if (g != 0.0) {
        m.set(e.a, e.b, m.getValue(e.a, e.b) - g);
        m.set(e.b, e.a, m.getValue(e.b, e.a) - g);
      }
      diag[e.a] += g;
      diag[e.b] += g;
      if (e.p.isCurrentSource()) {
        double cs = e.p instanceof MicroTickingElectricalProperties ? e.p.currentSource : e.p.currentSource();
        rhs[e.a] += -cs;
        rhs[e.b] += cs;
      }
    }
    for (int i = 0; i < nodes; i++) m.set(i, i, diag[i]);
    for (Edge e : vsources) {
      int ix = nodes + e.vsIndex;
      m.set(ix, e.a, 1.0);
      m.set(ix, e.b, -1.0);
      m.set(e.a, ix, 1.0);
      m.set(e.b, ix, -1.0);
      rhs[ix] = -e.p.voltageSource();
    }
    double[] x = vsources.isEmpty() ? CholeskySolver.solve(m, rhs) : LUSolver.solve(m, rhs);
    for (int i = 0; i < nodes; i++) all[i * n + micro] = x[i];
    for (Edge e : edges) {
      // ток ребра a→b: g·(Va − Vb) + источник тока (rhs[a] −= cs — ток cs уходит из a в b)
      if (e.vsIndex >= 0) e.current = x[nodes + e.vsIndex];
      else e.current = e.p.conductance() * (x[e.a] - x[e.b]) + (e.p.isCurrentSource() ? e.p.currentSource : 0);
    }
    for (Edge e : edges)
      if (e.p instanceof MicroTickingElectricalProperties mt) mt.afterTick(all, e.a, e.b, micro, n);
    return x;
  }

  // ---------------------------------------------------------------- запуск

  static String fmt(double v) {
    if (Double.isNaN(v)) return "—";
    if (Double.isInfinite(v)) return v > 0 ? "∞" : "−∞";
    double a = Math.abs(v);
    String s;
    if (a == 0) s = "0";
    else if (a >= 1e5 || a < 1e-3) s = String.format(Locale.ROOT, "%.3e", v);
    else if (a >= 100) s = String.format(Locale.ROOT, "%.2f", v);
    else s = String.format(Locale.ROOT, "%.4f", v);
    return s.replace('.', ',').replace("-", "−");
  }

  double energy() {
    double e = 0;
    for (Edge ed : edges) {
      if (ed.p instanceof CapacitorProperties c) e += c.capacitance * c.lastVoltage * c.lastVoltage / 2;
      if (ed.p instanceof InductorProperties l) e += l.inductance * l.lastCurrent * l.lastCurrent / 2;
    }
    return e;
  }

  public static void main(String[] args) throws Exception {
    try {
      new EeCircuit().run();
    } catch (Fail f) {
      System.err.println(f.getMessage());
      System.exit(2);
    }
  }

  void run() throws Exception {
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    Map<String, String> params = new LinkedHashMap<>();
    String line;
    while ((line = in.readLine()) != null && !line.equals("---")) {
      int eq = line.indexOf('=');
      if (eq > 0) params.put(line.substring(0, eq), line.substring(eq + 1));
    }
    int lineNo = 0;
    while ((line = in.readLine()) != null) {
      lineNo++;
      String t = line.replaceAll("(#|//).*$", "").trim();
      if (!t.isEmpty()) parseElement(t, lineNo);
    }
    if (edges.isEmpty()) throw new Fail("цепь пуста");

    int n = Integer.parseInt(params.getOrDefault("n", "8"));
    if (n < 1 || n > 1000) throw new Fail("n — от 1 до 1000 микрошагов на тик");
    double seconds = num(params.getOrDefault("seconds", "10"), "seconds");
    long ticks = Math.max(1, Math.round(seconds / TICK));
    if (ticks * n > 20_000_000L) throw new Fail("слишком долго: тиков×n > 20 млн — уменьшите seconds или n");
    double measureFrom = params.containsKey("measure_from") ? num(params.get("measure_from"), "measure_from") : ticks * TICK * 2 / 3;
    int samples = Integer.parseInt(params.getOrDefault("samples", "0"));
    double dt = TICK / n;

    // земля
    int nodes = nodeNames.size();
    ground = new double[nodes];
    double gG = num(params.getOrDefault("ground_g", "1000"), "ground_g");
    String gList = params.getOrDefault("ground", "");
    if (gList.isBlank() && nodeIds.containsKey("gnd")) gList = "gnd";
    for (String g : gList.split("[,\\s]+")) {
      if (g.isBlank()) continue;
      Integer id = nodeIds.get(g);
      if (id == null) throw new Fail("земля: нет узла «" + g + "» (узлы: " + String.join(", ", nodeNames) + ")");
      ground[id] = gG;
    }
    // CircuitBuilder.dfsAndGround: сеть без земли — 1000 См на один узел (в игре — по приоритету блока)
    int[] comp = new int[nodes];
    java.util.Arrays.fill(comp, -1);
    int comps = 0;
    for (int s = 0; s < nodes; s++) {
      if (comp[s] >= 0) continue;
      List<Integer> stack = new ArrayList<>(List.of(s));
      comp[s] = comps;
      List<Integer> members = new ArrayList<>();
      while (!stack.isEmpty()) {
        int u = stack.remove(stack.size() - 1);
        members.add(u);
        for (Edge e : edges) {
          int w = e.a == u ? e.b : e.b == u ? e.a : -1;
          if (w >= 0 && comp[w] < 0) {
            comp[w] = comps;
            stack.add(w);
          }
        }
      }
      boolean grounded = members.stream().anyMatch(u -> ground[u] != 0);
      if (!grounded) {
        int u = members.stream().mapToInt(Integer::intValue).min().getAsInt();
        ground[u] = 1000.0;
        notes.add("сеть без земли — 1000 См на узел «" + nodeNames.get(u) + "» (как dfsAndGround; в игре узел выбирает блок)");
      }
      comps++;
    }

    // наблюдаемые величины
    List<Probe> probes = new ArrayList<>();
    String probeList = params.getOrDefault("probes", "");
    final double[][] lastX = {new double[nodes]};
    lastXRef = lastX;
    snapshotState();
    if (probeList.isBlank()) {
      for (Map.Entry<String, Edge> en : byName.entrySet()) {
        Edge e = en.getValue();
        probes.add(voltageProbe(e, lastX));
        probes.add(currentProbe(e));
      }
    } else {
      for (String p : probeList.split("[;\\s]+")) {
        if (p.isBlank()) continue;
        probes.add(parseProbe(p.trim(), lastX));
      }
    }
    for (Probe p : probes) if (samples > 0) p.samples = new double[samples];

    boolean hasSources = edges.stream().anyMatch(e -> "VEI".contains(e.type));
    double e0 = energy(), prevE = e0, maxGrowth = 0, peakE = e0;
    double[] all = new double[nodes * n];
    long total = ticks * n;
    long measureMicro = Math.min(total - 1, Math.max(0, Math.round(measureFrom / dt)));
    long t0 = System.nanoTime();
    long k = 0;
    for (long t = 0; t < ticks; t++) {
      all = new double[nodes * n]; // SimulationTicker: новый массив на тик
      for (int i = 0; i < n; i++, k++) {
        lastX[0] = step(all, i, n, k, dt);
        double time = (k + 1) * dt;
        double e = energy();
        maxGrowth = Math.max(maxGrowth, e - prevE);
        peakE = Math.max(peakE, e);
        prevE = e;
        for (Probe p : probes) {
          double v = p.get.getAsDouble();
          if (Double.isNaN(p.first)) p.first = v;
          p.last = v;
          if (samples > 0) {
            long every = Math.max(1, total / samples);
            if ((k + 1) % every == 0 && (k + 1) / every - 1 < samples) p.samples[(int) ((k + 1) / every - 1)] = v;
          }
          if (k < measureMicro) {
            p.prev = v;
            p.prevT = time;
            continue;
          }
          p.min = Math.min(p.min, v);
          p.max = Math.max(p.max, v);
          p.sum += v;
          p.sumSq += v * v;
          p.count++;
          p.prev = v;
          p.prevT = time;
        }
      }
    }
    long nanos = System.nanoTime() - t0;

    StringBuilder out = new StringBuilder();
    out.append(String.format(Locale.ROOT, "Цепь: %d узл., %d эл.; N=%d микрошагов на тик, dt=%s мс, %s с (%d тиков, %d шагов); решатель — %s%n",
        nodes, byName.size(), n, fmt(dt * 1000), fmt(ticks * TICK), ticks, total,
        vsources.isEmpty() ? "CholeskySolver" : "LUSolver (есть идеальные источники E)"));
    out.append("Узлы: ").append(String.join(", ", nodeNames)).append("; земля: ");
    List<String> gs = new ArrayList<>();
    for (int i = 0; i < nodes; i++) if (ground[i] != 0) gs.add(nodeNames.get(i) + " (" + fmt(ground[i]) + " См)");
    out.append(String.join(", ", gs)).append('\n');
    for (String note : notes) out.append("• ").append(note).append('\n');
    out.append(String.format(Locale.ROOT, "Окно замера: с %s с до конца%n", fmt(measureMicro * dt)));
    out.append("\nВеличина | конец | мин | макс | ампл. (размах/2) | сред. | СКЗ | частота\n");
    // частоту считает отдельный прогон: повторять симуляцию дешевле, чем хранить ряды
    double[] freqs = frequencies(probes, n, ticks, dt, measureMicro);
    for (int i = 0; i < probes.size(); i++) {
      Probe p = probes.get(i);
      double mean = p.count > 0 ? p.sum / p.count : Double.NaN;
      double rms = p.count > 0 ? Math.sqrt(p.sumSq / p.count) : Double.NaN;
      out.append(String.format("%s, %s | %s | %s | %s | %s | %s | %s | %s%n", p.label, p.unit, fmt(p.last), fmt(p.min),
          fmt(p.max), fmt((p.max - p.min) / 2), fmt(mean), fmt(rms), Double.isNaN(freqs[i]) ? "—" : fmt(freqs[i]) + " Гц"));
    }
    if (e0 > 0 || peakE > 0) {
      double eEnd = energy();
      out.append(String.format("%nЭнергия L и C: в начале %s Дж, в конце %s Дж, макс. %s Дж", fmt(e0), fmt(eEnd), fmt(peakE)));
      if (!hasSources) {
        boolean grew = maxGrowth > 1e-9 * Math.max(e0, 1e-30);
        out.append(String.format("; рост за микрошаг max %s Дж — %s", fmt(maxGrowth),
            grew ? "РОСТ энергии без источников (неустойчиво или ошибка цепи)" : "не растёт (неявный Эйлер гасит)"));
        if (e0 > 0 && eEnd > 0 && eEnd < e0) {
          double tau = (ticks * TICK) / Math.log(e0 / eEnd); // E ~ e^(−t/τ)
          out.append(String.format("; затухание: E убывает в e раз за %s с", fmt(tau)));
        }
      }
      out.append('\n');
    }
    if (samples > 0) {
      long every = Math.max(1, total / samples);
      out.append(String.format("%nРяд (каждые %d микрошаг., %s с):%nt, с", every, fmt(every * dt)));
      for (Probe p : probes) out.append(" | ").append(p.label);
      out.append('\n');
      for (int s = 0; s < samples && (s + 1) * every <= total; s++) {
        out.append(fmt((s + 1) * every * dt));
        for (Probe p : probes) out.append(" | ").append(fmt(p.samples[s]));
        out.append('\n');
      }
    }
    out.append(String.format("%nСчёт: %s мс (%s мкс на микрошаг).%n", fmt(nanos / 1e6), fmt(nanos / 1e3 / total)));
    System.out.print(out);
  }

  /** Частота по восходящим переходам через середину окна: повторный прогон с теми же начальными условиями. */
  double[] frequencies(List<Probe> probes, int n, long ticks, double dt, long measureMicro) {
    double[] res = new double[probes.size()];
    java.util.Arrays.fill(res, Double.NaN);
    // повторный прогон с исходным состоянием элементов (snapshotState перед первым)
    restore();
    double[] mids = new double[probes.size()];
    for (int i = 0; i < probes.size(); i++) mids[i] = (probes.get(i).max + probes.get(i).min) / 2;
    double[] prev = new double[probes.size()];
    java.util.Arrays.fill(prev, Double.NaN);
    List<List<Double>> ups = new ArrayList<>();
    for (int i = 0; i < probes.size(); i++) ups.add(new ArrayList<>());
    long k = 0;
    int nodes = nodeNames.size();
    for (long t = 0; t < ticks; t++) {
      double[] all = new double[nodes * n];
      for (int i = 0; i < n; i++, k++) {
        double[] x = step(all, i, n, k, dt);
        lastXRef[0] = x;
        if (k < measureMicro) continue;
        double time = (k + 1) * dt;
        for (int j = 0; j < probes.size(); j++) {
          Probe p = probes.get(j);
          if (!(p.max - p.min > 1e-9 * Math.max(1, Math.abs(p.max)))) continue;
          double v = p.get.getAsDouble() - mids[j];
          if (prev[j] < 0 && v >= 0) ups.get(j).add(time - dt * v / (v - prev[j]));
          prev[j] = v;
        }
      }
    }
    for (int j = 0; j < probes.size(); j++) {
      List<Double> u = ups.get(j);
      if (u.size() >= 2) res[j] = (u.size() - 1) / (u.get(u.size() - 1) - u.get(0));
    }
    return res;
  }

  // ---------------------------------------------------------------- состояние для повторного прогона

  double[] snapshot;
  double[][] lastXRef;

  void snapshotState() {
    snapshot = new double[edges.size()];
    for (int i = 0; i < edges.size(); i++) {
      ElectricalProperties p = edges.get(i).p;
      if (p instanceof InductorProperties l) snapshot[i] = l.lastCurrent;
      else if (p instanceof CapacitorProperties c) snapshot[i] = c.lastVoltage;
      else if (p instanceof DiodeProperties d) snapshot[i] = d.lastVoltage;
    }
  }

  void restore() {
    for (int i = 0; i < edges.size(); i++) {
      ElectricalProperties p = edges.get(i).p;
      if (p instanceof InductorProperties l) l.lastCurrent = snapshot[i];
      else if (p instanceof CapacitorProperties c) c.lastVoltage = snapshot[i];
      else if (p instanceof DiodeProperties d) d.lastVoltage = snapshot[i];
    }
  }

  // ---------------------------------------------------------------- наблюдаемые

  Probe voltageProbe(Edge e, double[][] lastX) {
    lastXRef = lastX;
    int a = e.type.equals("V") || e.type.equals("E") || e.type.equals("D") ? e.b : e.a;
    int b = a == e.a ? e.b : e.a;
    // L/C с r: напряжение всего блока — между внешними выводами
    if (byName.containsKey(e.name) && (e.type.equals("L") || e.type.equals("C"))) {
      Edge r = edges.stream().filter(x -> x.name.equals(e.name + ".r")).findFirst().orElse(null);
      if (r != null) b = r.a;
    }
    int fa = a, fb = b;
    return new Probe("U(" + e.name + ")", "В", () -> lastXRef[0][fa] - lastXRef[0][fb]);
  }

  Probe currentProbe(Edge e) {
    // V, E — ток из узла a во внешнюю цепь; D — от анода к катоду (ребро D хранится катод→анод); прочие — a→b
    if (e.type.equals("V") || e.type.equals("E"))
      return new Probe("I(" + e.name + ") из «" + nodeNames.get(e.b) + "»", "А", () -> e.current);
    if (e.type.equals("D")) return new Probe("I(" + e.name + ")", "А", () -> -e.current);
    return new Probe("I(" + e.name + ")", "А", () -> e.current);
  }

  Probe parseProbe(String spec, double[][] lastX) {
    lastXRef = lastX;
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("^([VIUvi])\\(([^,()]+)(?:,([^()]+))?\\)$").matcher(spec);
    if (spec.equalsIgnoreCase("E")) return new Probe("E(L+C)", "Дж", this::energy);
    if (!m.matches()) throw new Fail("наблюдаемая «" + spec + "»: V(узел), V(узел,узел), U(элемент), I(элемент) или E");
    String kind = m.group(1).toUpperCase(Locale.ROOT), x = m.group(2).trim(), y = m.group(3);
    if (kind.equals("V")) {
      Integer a = nodeIds.get(x);
      if (a == null) throw new Fail("нет узла «" + x + "»");
      Integer b = y == null ? null : nodeIds.get(y.trim());
      if (y != null && b == null) throw new Fail("нет узла «" + y.trim() + "»");
      int fa = a;
      if (b == null) return new Probe("V(" + x + ")", "В", () -> lastXRef[0][fa]);
      int fb = b;
      return new Probe("V(" + x + "," + y.trim() + ")", "В", () -> lastXRef[0][fa] - lastXRef[0][fb]);
    }
    Edge e = byName.get(x);
    if (e == null) throw new Fail("нет элемента «" + x + "» (элементы: " + String.join(", ", byName.keySet()) + ")");
    return kind.equals("U") ? voltageProbe(e, lastX) : currentProbe(e);
  }
}
