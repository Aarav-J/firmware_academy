import type { CourseUnit } from '../types';

const BRIGHTNESS_INPUT = { pin: 14, label: 'Simulated brightness control (A0)', min: 0, max: 5 };

export const controlOutputsWithPwmUnit: CourseUnit = {
  id: 'control-outputs-with-pwm',
  title: 'Control outputs with PWM',
  description: 'Control an average output level using a rapidly switching digital signal — real hardware PWM, measured.',
  lessons: [
    {
      id: 'fast-switching-different-effect',
      title: 'Fast switching, different effect',
      description: 'A pin is only ever fully on or off; switching it fast enough changes what that means.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Average level, not analog voltage',
          paragraphs: [
            'digitalWrite() can only set a pin fully HIGH or fully LOW — there is no in-between voltage to write directly. analogWrite(pin, value) does not change that; instead, it switches the pin HIGH and LOW rapidly, hundreds of times per second, with value (0-255) controlling what fraction of each cycle is spent HIGH. That fraction is the duty cycle.',
            'An LED, or any sufficiently fast-responding device, cannot react individually to switching that fast — what it responds to is the average energy delivered, which tracks the duty cycle. analogWrite(pin, 128) is about 50% duty cycle; analogWrite(pin, 255) is continuously HIGH.',
            'This only works on specific pins wired to the Uno\'s hardware timers — on the Uno, pins 3, 5, 6, 9, 10, and 11. Calling analogWrite() on a pin without that hardware support does not produce PWM.',
          ],
          takeaway: 'analogWrite() rapidly switches a pin fully on and off; the duty cycle — not a true analog voltage — is what a device actually responds to.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Duty cycle and apparent brightness',
          concept: 'duty-cycle',
          paragraphs: [
            'Adjust the duty cycle and compare the raw switching waveform to the apparent brightness bar.',
          ],
          instruction: 'Set the duty cycle to 0%, 50%, and 100% and compare the waveform shape at each setting.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Convert a request to a value',
          prompt: 'You want approximately 75% duty cycle using analogWrite(), which takes a value from 0 to 255. Which value is closest?',
          options: [
            { id: 'value-75', label: '75, since the request was 75%.' },
            { id: 'value-191', label: 'About 191, since 75% of 255 is approximately 191.' },
            { id: 'value-255', label: '255, rounding up to the maximum.' },
          ],
          answerId: 'value-191',
          explanation: 'analogWrite()\'s argument is a fraction of 255, not a direct percentage. 75% of 255 is about 191.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Set a specific duty cycle',
          paragraphs: [
            'Drive pin 9 with analogWrite() at a duty cycle of approximately 75%. The check measures the real switching waveform your compiled sketch actually produces.',
            'Pin 9 is one of the Uno\'s PWM-capable pins, driven by a real hardware timer — the measured percentage comes from real pin transitions, not a reported setting.',
          ],
          starterCode: `const int LED = 9;

void setup() {
  pinMode(LED, OUTPUT);
  // Set approximately 75% duty cycle with analogWrite.
}

void loop() {}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'duty-cycle-match', label: 'Produce a measured duty cycle of about 75% on D9', rule: 'duty-cycle-match', pin: 9, highMs: 75 },
          ],
          hints: [
            'analogWrite(LED, 191) is close enough — the check allows about ±5 percentage points.',
            'A single analogWrite() call in setup() is enough; the hardware timer keeps producing the waveform without any code running in loop().',
            'Let the board run for at least a few PWM cycles — about 20 ms — before checking your work.',
          ],
        },
      ],
    },
    {
      id: 'control-brightness-with-an-input',
      title: 'Control brightness with an input',
      description: 'Map a live analog reading onto an output command.',
      durationMinutes: 16,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Map one range onto another',
          paragraphs: [
            'A common pattern combines the previous two units: read an analog input, scale it, and use the result to set an output. Instead of a fixed brightness, the LED tracks a live control — the same relationship a dimmer knob or a light sensor would drive.',
            'Both ranges matter here: analogRead() returns 0-1023, while analogWrite() expects 0-255. The map(value, fromLow, fromHigh, toLow, toHigh) function performs this kind of linear rescaling in one call: map(raw, 0, 1023, 0, 255).',
            'This is still a digital-only output underneath — analogWrite() is still switching the pin fully on and off, just at a duty cycle that now continuously follows your analog input.',
          ],
          takeaway: 'map() rescales one measured range onto another, turning an analog reading directly into a PWM command.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'From input to duty cycle',
          concept: 'analog-input',
          paragraphs: [
            'This reuses the analog-to-count model: the next exercise maps that same count onto a PWM duty cycle.',
          ],
          instruction: 'Pick a voltage and predict the duty cycle: voltage ÷ 5 gives the fraction, as a fraction of full duty cycle.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Predict the resulting duty cycle',
          prompt: 'The analog input reads 2.5V (about half of 5V), and your sketch correctly maps the raw ADC count directly onto a 0-255 PWM value. What duty cycle results?',
          options: [
            { id: 'duty-0', label: 'About 0%, since nothing is being written directly.' },
            { id: 'duty-50', label: 'About 50%, since the input is at half of its range.' },
            { id: 'duty-100', label: 'About 100%, since any nonzero input drives full brightness.' },
          ],
          answerId: 'duty-50',
          explanation: 'A proportional mapping preserves the fraction: half of the input range maps to half of the output range, which is about 50% duty cycle.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Build a brightness control',
          paragraphs: [
            'Read the analog input on A0 and drive pin 9 with a PWM duty cycle that tracks it proportionally: 0V should produce 0% duty cycle, 5V should produce 100% duty cycle.',
            'Move the voltage slider below the board to different levels and check your work; the measured duty cycle should track whatever voltage you last set.',
          ],
          starterCode: `const int LED = 9;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  int raw = analogRead(A0);
  // Map raw (0-1023) onto a PWM value (0-255) and analogWrite it to LED.
  delay(20);
}
`,
          analogInput: BRIGHTNESS_INPUT,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'duty-tracks-input', label: 'Track the applied voltage proportionally in the measured D9 duty cycle', rule: 'duty-tracks-input', pin: 9 },
          ],
          hints: [
            'int pwm = map(raw, 0, 1023, 0, 255); analogWrite(LED, pwm);',
            'Set the voltage slider to a specific value, let the sketch run for a brief moment, then check your work.',
            'The check compares the real measured duty cycle to the expected percentage within about 8 percentage points, allowing for ADC quantization and rounding.',
          ],
        },
      ],
    },
  ],
};
