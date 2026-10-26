import type { CourseUnit } from '../types';

const SENSOR_INPUT = { pin: 14, label: 'Simulated sensor voltage (A0)', min: 0, max: 5 };

export const readAnalogSignalsUnit: CourseUnit = {
  id: 'read-analog-signals',
  title: 'Read analog signals',
  description: 'Interpret a changing voltage as useful input data, using a real ADC channel you control.',
  lessons: [
    {
      id: 'from-voltage-to-a-number',
      title: 'From voltage to a number',
      description: 'analogRead converts a real voltage into a 10-bit count — not a continuous value.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'A quantized measurement',
          paragraphs: [
            'digitalRead() only distinguishes two states. analogRead(pin) measures a continuously varying voltage and converts it into a number between 0 and 1023 — 1024 possible values, produced by the Uno\'s 10-bit analog-to-digital converter (ADC). 0 corresponds to 0V, 1023 corresponds to the 5V reference.',
            'This conversion is quantized: two voltages close enough together can round to the same count, and the smallest distinguishable step is about 5V ÷ 1024 ≈ 4.9 mV. analogRead() cannot tell you about a change smaller than that step.',
            'This exercise drives a real voltage into a real ADC channel — the slider control below the board sets an actual input your compiled sketch\'s analogRead(A0) reads, exactly as a potentiometer or sensor would.',
          ],
          takeaway: 'analogRead() returns a 0-1023 count, not volts directly — quantized in steps of about 4.9 mV.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Watch the quantization',
          concept: 'analog-input',
          paragraphs: [
            'Move the voltage slider and watch the raw ADC count change in discrete steps, not smoothly.',
          ],
          instruction: 'Sweep slowly near a count boundary and notice the count only changes at specific voltage thresholds.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Estimate the raw count',
          prompt: 'The analog input is set to 2.5V — the midpoint of the 0-5V range. What should analogRead(A0) return, approximately?',
          options: [
            { id: 'count-0', label: '0, since nothing is being actively driven.' },
            { id: 'count-512', label: 'About 512, the midpoint of the 0-1023 range.' },
            { id: 'count-1023', label: '1023, the maximum the ADC can report.' },
          ],
          answerId: 'count-512',
          explanation: 'The ADC maps the voltage range linearly onto the count range. Half of 5V should produce approximately half of 1023.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Report the raw ADC count',
          paragraphs: [
            'Print the raw value from analogRead(A0) over Serial, repeatedly, so the check can confirm it matches the real applied voltage.',
            'Move the voltage slider below the board, let the reading settle for a moment, then check your work.',
          ],
          starterCode: `void setup() {
  Serial.begin(9600);
}

void loop() {
  // Print the raw analogRead(A0) value.
  delay(100);
}
`,
          analogInput: SENSOR_INPUT,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'reports-analog-value', label: 'Report the real raw ADC count for the applied voltage', rule: 'reports-analog-value' },
          ],
          hints: [
            'Serial.println(analogRead(A0)) is the whole exercise.',
            'A0 is a predefined constant; you do not need to compute a pin number.',
            'Move the slider, wait a moment for a few printed lines at the new voltage, then check your work.',
          ],
        },
      ],
    },
    {
      id: 'from-a-number-to-a-measurement',
      title: 'From a number to a measurement',
      description: 'Convert the raw count into a unit a person would actually read.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Scale the count back to volts',
          paragraphs: [
            'A raw ADC count by itself is not a useful measurement to show anyone — "612" means nothing without knowing it is out of 1023, over a 5V range. Converting it back to volts makes it meaningful: voltage = rawCount / 1023.0 * 5.0.',
            'This calculation must use floating-point math (a float, or an explicit 5.0 rather than 5) — dividing two integers in C truncates the fractional part, silently producing 0 for any count below 1023 divided by a larger integer.',
            'The same scaling idea generalizes: whatever physical quantity a real sensor represents, its datasheet gives a formula for turning a raw count (or raw voltage) into that quantity\'s real units.',
          ],
          takeaway: 'A raw ADC count means nothing without the scaling formula that converts it into real units.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Count and voltage together',
          concept: 'analog-input',
          paragraphs: [
            'This reuses the previous lesson\'s model. This time, watch both numbers and confirm the scaling relationship for yourself.',
          ],
          instruction: 'Pick a few voltages and verify count ÷ 1023 × 5 reproduces the voltage shown, within rounding.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Spot the integer division bug',
          prompt: 'A sketch computes: int raw = analogRead(A0); float voltage = raw / 1023 * 5;. For a mid-range reading, what does this actually produce?',
          options: [
            { id: 'correct-voltage', label: 'The correct voltage, since voltage is declared as a float.' },
            { id: 'always-zero', label: 'Always 0.0, because raw / 1023 is integer division and truncates to 0 before the multiplication.' },
            { id: 'always-five', label: 'Always 5.0, regardless of the actual reading.' },
          ],
          answerId: 'always-zero',
          explanation: 'raw and 1023 are both integers, so raw / 1023 performs integer division first and truncates to 0 for any raw below 1023. The result is only cast to float afterward, which is too late — multiplying 0 by 5 is still 0.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Print the real voltage',
          paragraphs: [
            'Convert the raw ADC count into volts and print it, so the printed number matches the actual applied voltage, not a raw count or a truncated zero.',
            'Use correct floating-point scaling: multiply by 5.0 and divide by 1023.0, or cast to float before dividing.',
          ],
          starterCode: `void setup() {
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(A0);
  // Scale raw to real volts using floating-point math, then print it.
  delay(100);
}
`,
          analogInput: SENSOR_INPUT,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'scales-measurement', label: 'Print the real voltage, correctly scaled from the raw count', rule: 'scales-measurement' },
          ],
          hints: [
            'float voltage = raw / 1023.0 * 5.0; — the .0 on 1023 forces floating-point division.',
            'Serial.println(voltage) prints a float with a readable number of decimal places by default.',
            'The check compares your printed number to the real applied voltage within 0.1V.',
          ],
        },
      ],
    },
    {
      id: 'measurements-fluctuate',
      title: 'Measurements fluctuate',
      description: 'A single threshold chatters near its boundary; hysteresis keeps a decision stable.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'A clean-looking boundary is rarely clean in practice',
          paragraphs: [
            'A real measurement has noise: tiny fluctuations from the sensor, the wiring, and the ADC itself. If an indicator flips the instant a reading crosses a single threshold, a reading that hovers right at that threshold makes the indicator flicker rapidly — technically correct at every instant, but useless to look at.',
            'Hysteresis solves this with two thresholds instead of one: a higher threshold to turn on, a lower threshold to turn off, with a gap between them. Once on, the reading has to drop below the lower threshold to turn off — passing back through the middle does not flip it. This trades a small amount of precision for a stable, readable decision.',
            'This exercise checks that your indicator reaches the correct state once a reading is clearly on one side or the other of the threshold region. Confirming the no-flicker behavior in the ambiguous middle band is something you can observe directly by sweeping the slider slowly across it on the live board.',
          ],
          takeaway: 'Two thresholds with a gap between them stop a noisy reading from flickering a decision.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Compare one threshold to a hysteresis band',
          concept: 'hysteresis',
          paragraphs: [
            'Hold the slider near the middle in each mode and compare how the indicator behaves.',
          ],
          instruction: 'Switch to "Single threshold" first, hover near the middle, then switch to "With hysteresis" and try the same thing.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Will it flip back?',
          prompt: 'An indicator uses hysteresis: on above 2.7V, off below 2.3V. It is currently ON because the voltage recently exceeded 2.7V. The voltage now settles at 2.5V. What happens?',
          options: [
            { id: 'turns-off', label: 'It turns off immediately, since 2.5V is below the 2.7V on-threshold.' },
            { id: 'stays-on', label: 'It stays on, since 2.5V has not dropped below the 2.3V off-threshold.' },
            { id: 'flickers', label: 'It flickers rapidly, since 2.5V is between the two thresholds.' },
          ],
          answerId: 'stays-on',
          explanation: 'Hysteresis only reacts at the boundaries it defines. An already-on indicator stays on anywhere above the lower (off) threshold, including the gap between the two thresholds.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Build a hysteresis indicator',
          paragraphs: [
            'Drive D13 as an indicator with hysteresis: turn it HIGH once the analog input exceeds 2.7V, and only turn it LOW again once the input drops below 2.3V. Hold between those thresholds.',
            'Keep the current indicator state in a variable that persists between loop() calls, and update it only at the two threshold crossings.',
          ],
          starterCode: `const int LED = 13;
bool indicatorOn = false;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  int raw = analogRead(A0);
  float voltage = raw / 1023.0 * 5.0;
  // Turn indicatorOn true above 2.7V, false below 2.3V. Hold between.
  digitalWrite(LED, indicatorOn ? HIGH : LOW);
  delay(50);
}
`,
          analogInput: SENSOR_INPUT,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'hysteresis-indicator', label: 'Read D13 correctly for voltages clearly above or below the thresholds', rule: 'hysteresis-indicator', pin: 13 },
          ],
          hints: [
            'if (voltage > 2.7) indicatorOn = true; else if (voltage < 2.3) indicatorOn = false; — leaving indicatorOn unchanged in between is the entire technique.',
            'Move the slider to a voltage clearly above 2.7V, check that D13 lights, then move it clearly below 2.3V and check that it turns off.',
            'Try sweeping slowly through the middle on the live board — a correct implementation will not flicker.',
          ],
        },
      ],
    },
  ],
};
