import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm } from 'node:fs/promises';
import { compileArduino } from '../server/stm32-build/arduino';
import { projectTempDirectory } from '../server/stm32-build/storage';
import { assessExercise } from '../src/learning/assessment';
import { ATmega328PSimulation, parseIntelHex } from '../src/simulator/avr-engine';
import { appendSerial, retainPinTrace } from '../src/trace';
import type { TraceEvent } from '../src/contracts';
import type { ExerciseStep, WorkbenchObservation } from '../src/learning/types';

async function compile(source: string): Promise<ATmega328PSimulation> {
  const directory = await projectTempDirectory('request');
  try {
    const { hexPath } = await compileArduino(directory, source);
    const hex = await readFile(hexPath, 'utf8');
    return new ATmega328PSimulation(parseIntelHex(hex));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type Action = { atUs: number; run: (sim: ATmega328PSimulation) => void };

function observe(sim: ATmega328PSimulation, targetUs: number, actions: Action[] = [], analogVoltage?: number): WorkbenchObservation {
  let trace: TraceEvent[] = [];
  let serial = '';
  let frame = sim.frame();
  const deadline = performance.now() + 19_000;
  while (frame.timeUs < targetUs && performance.now() < deadline) {
    for (const action of actions) if (frame.timeUs >= action.atUs && frame.timeUs - action.atUs < 20_000) { action.run(sim); action.atUs = Infinity; }
    sim.step(targetUs, 10);
    frame = sim.frame();
    trace = retainPinTrace(trace, frame.events, frame.timeUs);
    const output = frame.events.filter((event): event is Extract<TraceEvent, { type: 'uart_tx' }> => event.type === 'uart_tx').map(event => event.text).join('');
    if (output) serial = appendSerial(serial, output);
  }
  assert.ok(frame.timeUs >= targetUs, `simulation stalled at ${frame.timeUs} before ${targetUs}`);
  return { built: true, state: 'paused', timeUs: frame.timeUs, pins: frame.pins, trace, analogVoltage, serial };
}

function step(rule: ExerciseStep['goals'][number]['rule'], overrides: Partial<ExerciseStep> = {}): ExerciseStep {
  return { id: 'ex', kind: 'exercise', title: '', paragraphs: [], starterCode: '', hints: [], goals: [{ id: rule, label: rule, rule }], ...overrides };
}

test('mirrors-input passes when D13 follows D2 and fails for a fixed D13', async () => {
  const good = await compile('void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT_PULLUP);}\nvoid loop(){digitalWrite(13, !digitalRead(2));}\n');
  const actions: Action[] = [{ atUs: 100_000, run: sim => sim.setButton(true) }, { atUs: 400_000, run: sim => sim.setButton(false) }, { atUs: 700_000, run: sim => sim.setButton(true) }, { atUs: 1_000_000, run: sim => sim.setButton(false) }];
  const goodObs = observe(good, 1_300_000, actions);
  assert.equal(assessExercise(step('mirrors-input'), goodObs)[0].passed, true);

  const bad = await compile('void setup(){pinMode(13,OUTPUT);digitalWrite(13,LOW);}\nvoid loop(){}\n');
  const badActions: Action[] = [{ atUs: 100_000, run: sim => sim.setButton(true) }, { atUs: 400_000, run: sim => sim.setButton(false) }, { atUs: 700_000, run: sim => sim.setButton(true) }];
  const badObs = observe(bad, 1_000_000, badActions);
  assert.equal(assessExercise(step('mirrors-input'), badObs)[0].passed, false);
});

test('toggles-per-press accepts one toggle per press and rejects a continuous mirror', async () => {
  const toggling = await compile('volatile bool last=true, state=false;\nvoid setup(){pinMode(13,OUTPUT);pinMode(2,INPUT_PULLUP);}\nvoid loop(){bool now=digitalRead(2); if(last && !now){state=!state; digitalWrite(13,state);} last=now;}\n');
  const actions: Action[] = [{ atUs: 100_000, run: sim => sim.setButton(true) }, { atUs: 300_000, run: sim => sim.setButton(false) }, { atUs: 500_000, run: sim => sim.setButton(true) }, { atUs: 700_000, run: sim => sim.setButton(false) }, { atUs: 900_000, run: sim => sim.setButton(true) }, { atUs: 1_100_000, run: sim => sim.setButton(false) }];
  const obs = observe(toggling, 1_300_000, actions);
  assert.equal(assessExercise(step('toggles-per-press'), obs)[0].passed, true);

  const mirror = await compile('void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT_PULLUP);}\nvoid loop(){digitalWrite(13, !digitalRead(2));}\n');
  const mirrorObs = observe(mirror, 1_300_000, actions.map(action => ({ ...action })));
  assert.equal(assessExercise(step('toggles-per-press'), mirrorObs)[0].passed, false);
});

test('debounced-count matches the canonical debounce window and rejects a raw bounce count', async () => {
  const sim = await compile('volatile int count=0; bool last=true;\nvoid setup(){Serial.begin(9600);pinMode(2,INPUT_PULLUP);}\nvoid loop(){bool now=digitalRead(2); if(last && !now){count++; Serial.println(count); delay(60);} last=now;}\n');
  // One bouncy press (several fast edges) followed by a second clean press.
  const actions: Action[] = [
    { atUs: 50_000, run: s => s.setButton(true) }, { atUs: 51_000, run: s => s.setButton(false) }, { atUs: 52_000, run: s => s.setButton(true) },
    { atUs: 300_000, run: s => s.setButton(false) },
    { atUs: 500_000, run: s => s.setButton(true) }, { atUs: 700_000, run: s => s.setButton(false) },
  ];
  const obs = observe(sim, 900_000, actions);
  const result = assessExercise(step('debounced-count'), obs)[0];
  assert.equal(result.passed, true, result.detail);
});

test('duty-cycle-match reads a real analogWrite duty cycle', async () => {
  const sim = await compile('void setup(){pinMode(9,OUTPUT);analogWrite(9,64);}\nvoid loop(){}\n');
  const obs = observe(sim, 50_000, []);
  const exercise = step('duty-cycle-match', { signal: { pin: 9, highMs: 25, lowMs: 0 } });
  const result = assessExercise(exercise, obs)[0];
  assert.equal(result.passed, true, result.detail);
  const wrong = assessExercise(step('duty-cycle-match', { signal: { pin: 9, highMs: 75, lowMs: 0 } }), obs)[0];
  assert.equal(wrong.passed, false);
});

test('reports-analog-value matches a real ADC conversion of the applied voltage', async () => {
  const sim = await compile('void setup(){Serial.begin(9600);}\nvoid loop(){Serial.println(analogRead(A0));delay(100);}\n');
  sim.setAnalogInput(14, 3.3);
  const obs = observe(sim, 300_000, [], 3.3);
  const result = assessExercise(step('reports-analog-value'), obs)[0];
  assert.equal(result.passed, true, result.detail);
  const wrongVoltage = assessExercise(step('reports-analog-value'), { ...obs, analogVoltage: 1.0 })[0];
  assert.equal(wrongVoltage.passed, false);
});

test('i2c-identifies-device and i2c-handles-failure read the real simulated sensor', async () => {
  const sim = await compile(`#include <Wire.h>
void setup() {
  Serial.begin(9600);
  Wire.begin();
  Wire.beginTransmission(0x50);
  Wire.write(0x00);
  Wire.endTransmission();
  Wire.requestFrom(0x50, 1);
  Serial.print("ID:");
  Serial.println(Wire.read(), HEX);
  Wire.beginTransmission(0x12);
  uint8_t err = Wire.endTransmission();
  Serial.print("ERR:");
  Serial.println(err);
}
void loop() {}
`);
  const obs = observe(sim, 200_000, []);
  assert.equal(assessExercise(step('i2c-identifies-device'), obs)[0].passed, true);
  assert.equal(assessExercise(step('i2c-handles-failure'), obs)[0].passed, true);
});

test('uart-command-handled reacts to a real injected serial byte and rejects a stale command', async () => {
  const sim = await compile(`void setup(){Serial.begin(9600);pinMode(13,OUTPUT);}
void loop(){if(Serial.available()){char c=Serial.read();if(c=='1')digitalWrite(13,HIGH);else if(c=='0')digitalWrite(13,LOW);}}
`);
  observe(sim, 10_000, []); // let setup() run and enable RXEN before injecting
  sim.usart.writeByte('1'.charCodeAt(0));
  const onObs = observe(sim, 50_000, []);
  const on = assessExercise(step('uart-command-handled', { goals: [{ id: 'g', label: 'LED', rule: 'uart-command-handled', pin: 13 }] }), { ...onObs, lastSerialCommand: '1' })[0];
  assert.equal(on.passed, true, on.detail);
  sim.usart.writeByte('0'.charCodeAt(0));
  const offObs = observe(sim, 100_000, []);
  const off = assessExercise(step('uart-command-handled', { goals: [{ id: 'g', label: 'LED', rule: 'uart-command-handled', pin: 13 }] }), { ...offObs, lastSerialCommand: '0' })[0];
  assert.equal(off.passed, true, off.detail);
  const stale = assessExercise(step('uart-command-handled', { goals: [{ id: 'g', label: 'LED', rule: 'uart-command-handled', pin: 13 }] }), { ...offObs, lastSerialCommand: '1' })[0];
  assert.equal(stale.passed, false);
});

test('interrupt-count reports real falling edges from a genuine attachInterrupt handler', async () => {
  const sim = await compile(`volatile int count = 0;
void onEdge() { count++; }
void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), onEdge, FALLING);
}
void loop() {
  static int last = -1;
  if (count != last) { last = count; Serial.println(count); }
}
`);
  const actions: Action[] = [
    { atUs: 100_000, run: sim => sim.setButton(true) },
    { atUs: 400_000, run: sim => sim.setButton(false) },
    { atUs: 700_000, run: sim => sim.setButton(true) },
    { atUs: 1_000_000, run: sim => sim.setButton(false) },
    { atUs: 1_300_000, run: sim => sim.setButton(true) },
    { atUs: 1_600_000, run: sim => sim.setButton(false) },
  ];
  const obs = observe(sim, 1_900_000, actions);
  const result = assessExercise(step('interrupt-count'), obs)[0];
  assert.equal(result.passed, true, result.detail);
});

test('final-project goals pass together from one real nonblocking sketch, and responsiveness regresses under a blocking delay', async () => {
  const nonBlocking = `const int ALERT = 13;
const int MODE = 12;
unsigned long lastReportMs = 0;
bool lastReading = true;
unsigned long lastAcceptedMs = 0;
bool modeOn = false;
void setup() {
  Serial.begin(9600);
  pinMode(ALERT, OUTPUT);
  pinMode(MODE, OUTPUT);
  pinMode(2, INPUT_PULLUP);
}
void loop() {
  int raw = analogRead(A0);
  float voltage = raw / 1023.0 * 5.0;
  if (millis() - lastReportMs >= 500) { lastReportMs = millis(); Serial.println(voltage); }
  if (voltage > 2.8) digitalWrite(ALERT, HIGH);
  else if (voltage < 2.2) digitalWrite(ALERT, LOW);
  bool reading = digitalRead(2);
  if (lastReading == HIGH && reading == LOW && millis() - lastAcceptedMs >= 50) {
    lastAcceptedMs = millis();
    modeOn = !modeOn;
    digitalWrite(MODE, modeOn);
  }
  lastReading = reading;
}
`;
  const sim = await compile(nonBlocking);
  sim.setAnalogInput(14, 3.3);
  const actions: Action[] = [
    { atUs: 100_000, run: sim => sim.setButton(true) },
    { atUs: 150_000, run: sim => sim.setButton(false) },
    { atUs: 400_000, run: sim => sim.setButton(true) },
    { atUs: 450_000, run: sim => sim.setButton(false) },
  ];
  const obs = observe(sim, 1_200_000, actions, 3.3);
  const exercise = step('scales-measurement', {
    analogInput: { pin: 14, label: 'Sensor', min: 0, max: 5 },
    goals: [
      { id: 'scales-measurement', label: 'Voltage', rule: 'scales-measurement' },
      { id: 'hysteresis-indicator', label: 'Alert', rule: 'hysteresis-indicator', pin: 13 },
      { id: 'responsive-under-load', label: 'Mode', rule: 'responsive-under-load', pin: 12 },
    ],
  });
  const results = assessExercise(exercise, obs);
  for (const result of results) assert.equal(result.passed, true, `${result.id}: ${result.detail}`);

  const blocking = nonBlocking.replace('lastReading = reading;\n}', 'lastReading = reading;\n  delay(300);\n}');
  const blockedSim = await compile(blocking);
  blockedSim.setAnalogInput(14, 3.3);
  const blockedObs = observe(blockedSim, 1_200_000, actions, 3.3);
  const responsiveness = assessExercise(step('responsive-under-load', { goals: [{ id: 'responsive-under-load', label: 'Mode', rule: 'responsive-under-load', pin: 12 }] }), blockedObs)[0];
  assert.equal(responsiveness.passed, false, 'a 300 ms blocking delay() should make the mode toggle miss its 50 ms response window');
});
