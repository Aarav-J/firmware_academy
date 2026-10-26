import type { CourseUnit } from '../types';

const SENSOR_INPUT = { pin: 14, label: 'Simulated sensor voltage (A0)', min: 0, max: 5 };

export const finalProjectUnit: CourseUnit = {
  id: 'final-project',
  title: 'Final project',
  description: 'Combine every behavior from this course into one responsive device.',
  lessons: [
    {
      id: 'responsive-sensor-monitor',
      title: 'A responsive sensor monitor',
      description: 'Sample, report, alert, and stay responsive to a button — all at the same time, with no blocking delay().',
      durationMinutes: 28,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Everything you\'ve built, combined',
          paragraphs: [
            'This project has no new mechanism to learn — it combines ones you already have working: reading and scaling an analog input, reporting it over Serial, driving an indicator with hysteresis so it does not chatter, and handling a debounced button, all without a single blocking delay() call anywhere.',
            'The specification: read the simulated sensor voltage on A0. Print the real scaled voltage over Serial at a steady interval, using millis() rather than delay(). Drive D13 as a hysteresis alert using the same single-midpoint-threshold technique from Read analog signals, holding its state near the threshold rather than chattering. Toggle D12 once per debounced press on D2, exactly like the Read inputs unit, while all of the above keeps running without interruption.',
            'Nothing here is individually new. What makes it a genuine final project is that getting all four behaviors correct and running concurrently requires actual nonblocking structure — a single stray delay() anywhere will cause at least one of the checks to fail.',
          ],
          takeaway: 'A responsive device is several independent, correctly timed behaviors running together — not one big sequential program.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Revisit the hysteresis alert',
          concept: 'hysteresis',
          paragraphs: [
            'This reuses the hysteresis model from earlier in the course: a single threshold at the midpoint of the sensor range, with a dead zone around it where the indicator deliberately holds its last state instead of chattering.',
          ],
          instruction: 'Hold the slider near the midpoint and confirm the indicator does not chatter, same as before.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Find the mistake before you build',
          prompt: 'A draft of this project puts Serial.println(voltage); delay(500); inside loop(), right after sampling, to report readings about twice a second. What is wrong with this specific choice?',
          options: [
            { id: 'nothing-wrong', label: 'Nothing — a short, fixed reporting interval is exactly what delay(500) is for.' },
            { id: 'blocks-everything', label: 'The delay(500) blocks the button check and the hysteresis update for half a second on every single pass, hurting responsiveness.' },
            { id: 'too-fast', label: 'It reports too fast; delay(500) should be replaced with a longer delay.' },
          ],
          answerId: 'blocks-everything',
          explanation: 'Even a "short" half-second delay() still blocks button handling and the indicator update for that entire time, every single loop iteration — exactly the problem the Make it responsive unit covered.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Build the sensor monitor',
          paragraphs: [
            'Implement all four required behaviors together: a millis()-timed voltage report, a hysteresis alert on D13, and a debounced mode toggle on D12 — all running without any delay() call.',
            'Move the voltage slider and press the button while your sketch runs, in any order, and check your work once you believe all four behaviors are correct at once.',
          ],
          starterCode: `const int ALERT = 13;
const int MODE = 12;
const unsigned long REPORT_INTERVAL_MS = 500;

unsigned long lastReportMs = 0;
bool alertOn = false;

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

  // 1. Every REPORT_INTERVAL_MS, print voltage over Serial (millis()-timed).

  // 2. Hysteresis alert on ALERT: on above the midpoint, off below it, hold state in the dead zone between.

  // 3. Debounce D2 (50 ms window) and toggle MODE once per accepted press.
}
`,
          analogInput: SENSOR_INPUT,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'scales-measurement', label: 'Report the real scaled voltage over Serial', rule: 'scales-measurement' },
            { id: 'hysteresis-indicator', label: 'Drive D13 as a correct hysteresis alert around the sensor range midpoint', rule: 'hysteresis-indicator', pin: 13 },
            { id: 'responsive-under-load', label: 'Toggle D12 within 50 ms of each press, even while reporting and alerting', rule: 'responsive-under-load', pin: 12 },
          ],
          hints: [
            'Reuse the millis() elapsed-time pattern from Make it responsive for the reporting interval, the single-threshold hysteresis pattern from Read analog signals for the alert (for example, on above 2.8V, off below 2.2V — comfortably clear of the midpoint), and the debounce pattern from Read inputs for the mode toggle.',
            'Each of the three behaviors should use its own independent timestamp or state variable — none should depend on or block another.',
            'If one check keeps failing, verify there is no delay() anywhere in your sketch — even one call anywhere in loop() affects every other behavior.',
          ],
        },
      ],
    },
  ],
};
