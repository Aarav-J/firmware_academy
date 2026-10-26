import type { CourseUnit } from '../types';

export const readInputsUnit: CourseUnit = {
  id: 'read-inputs',
  title: 'Read inputs',
  description: 'Turn button signals into dependable program decisions, using the Uno\'s existing D2 button.',
  lessons: [
    {
      id: 'read-a-pin',
      title: 'Read a pin',
      description: 'Meet digitalRead, the internal pull-up resistor, and why an unconnected input is unreliable.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'A pin can read, not just write',
          paragraphs: [
            'Every lesson so far has written to a pin. digitalRead(pin) does the opposite: it asks the pin what voltage it currently sees, returning HIGH or LOW. The Uno\'s digital pin 2 (D2) is wired to an external pushbutton that pulls the pin to GND when pressed.',
            'A digital input needs a defined voltage at all times, not just while something is actively driving it. If nothing is connected, the pin can read HIGH or LOW unpredictably — a floating input. The Uno solves this for D2 with a pull-up: an internal resistor that weakly pulls the pin toward 5V whenever the button is not pressing it to GND.',
            'pinMode(pin, INPUT_PULLUP) enables that internal resistor. With it enabled: released reads HIGH (the pull-up wins), pressed reads LOW (the button overpowers the weak pull-up by connecting straight to GND). This is why the button is active-low — pressed means LOW, the opposite of what many people expect.',
            'Active-low wiring is common in real hardware because it needs no external resistor. The tradeoff is that your code must remember the inversion: "if (digitalRead(2) == LOW)" means "if pressed", not "if 0".',
          ],
          takeaway: 'With INPUT_PULLUP, the Uno\'s D2 button reads HIGH when released and LOW when pressed.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Compare a pulled-up input to a floating one',
          concept: 'pull-up-input',
          paragraphs: [
            'Toggle between INPUT_PULLUP and a plain, unconnected INPUT to see why the pull-up matters.',
            'Real floating-pin behavior depends on electrical noise this browser model cannot reproduce; the model marks it "undefined" instead of guessing a specific value, which is itself an accurate lesson: you cannot predict it either.',
          ],
          instruction: 'Switch to plain INPUT and notice the reading becomes unreliable. Switch back to INPUT_PULLUP, then press and release the button a few times.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'What does a released button read?',
          prompt: 'D2 is configured with pinMode(2, INPUT_PULLUP). The button is currently released — nothing is pressing it. What does digitalRead(2) return?',
          options: [
            { id: 'low-released', label: 'LOW, because an unpressed button reads LOW by default.' },
            { id: 'high-released', label: 'HIGH, because the internal pull-up holds the pin near 5V until something pulls it to GND.' },
            { id: 'undefined-released', label: 'It is undefined, the same as a floating pin.' },
          ],
          answerId: 'high-released',
          explanation: 'The pull-up resistor is always weakly pulling the pin toward 5V. Only the button, when pressed, is strong enough to override it and pull the pin to GND.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Light the LED while the button is held',
          paragraphs: [
            'Make the built-in LED (D13) turn on exactly while the D2 button is pressed, and turn off within about 30 ms of release. Since the button is active-low, "pressed" means digitalRead(2) returns LOW.',
            'Configure both pins in setup(): D13 as OUTPUT, D2 as INPUT_PULLUP. In loop(), read D2 on every pass and write the LED to match — HIGH output when the reading is LOW (pressed), LOW output when the reading is HIGH (released).',
            'Press the button a few times using the board controls, then check your work. The check follows the real D2 signal and the real D13 output from your compiled sketch.',
          ],
          starterCode: `void setup() {
  // Configure D13 as an output and D2 as a pulled-up input.
}

void loop() {
  // Read D2, then drive D13 to match: LOW reading -> LED on.
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'mirrors-input', label: 'Light D13 exactly while D2 reads LOW (pressed)', rule: 'mirrors-input' },
          ],
          hints: [
            'pinMode(2, INPUT_PULLUP) enables the internal resistor; no external wiring is required for this exercise.',
            'digitalRead(2) returns LOW while pressed. Write digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW) — or the equivalent using !digitalRead(2).',
            'Press and release the button at least three times before checking, so the check can confirm the relationship holds consistently.',
          ],
        },
      ],
    },
    {
      id: 'state-vs-event',
      title: 'State versus event',
      description: 'Separate "is it pressed right now" from "did a press just happen."',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'A level is not an event',
          paragraphs: [
            'digitalRead(2) tells you the button\'s current state: pressed or released, right now. It does not tell you whether that state just changed. loop() runs continuously, so a single physical press is actually read as LOW across many consecutive iterations — not once.',
            'To detect a press as a one-time event, compare the current reading to the previous one. A new press is specifically the transition from HIGH to LOW: previous reading was HIGH (released), current reading is LOW (pressed). Holding the button down produces LOW again on the next loop, but that is not a new press — previous was already LOW.',
            'This distinction matters whenever you want "do something once per press," like toggling a light or counting clicks. Acting on every LOW reading instead of the transition would repeat the action dozens of times for one press, since loop() runs far faster than a human can release a button.',
          ],
          takeaway: 'An event is a change between two readings, not the reading itself.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Spot the transition',
          concept: 'edge-event',
          paragraphs: [
            'Step through a sequence of readings and identify exactly which steps are new presses.',
            'Only one step in this sequence is a genuinely new press by this definition, even though several consecutive steps read LOW.',
          ],
          instruction: 'Advance through the readings one at a time and watch which steps the model marks as a new press.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Counting presses, not readings',
          prompt: 'A button is held down for exactly 400 ms while loop() runs about 10,000 times during that interval. Code increments a counter every time digitalRead(2) is LOW. What happens to the counter during that one press?',
          options: [
            { id: 'increments-once', label: 'It increments by 1, because it is one physical press.' },
            { id: 'increments-many', label: 'It increments thousands of times, once per loop iteration the button reads LOW.' },
            { id: 'stays-zero', label: 'It stays at 0 until the button is released.' },
          ],
          answerId: 'increments-many',
          explanation: 'Checking the level every iteration, without comparing to the previous reading, counts every iteration the button happens to be held — not the press itself.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Toggle the LED once per press',
          paragraphs: [
            'Make D13 toggle — flip from on to off, or off to on — exactly once per button press, regardless of how long the button is held. Holding the button must not keep toggling the LED.',
            'Keep a variable remembering the previous reading across loop() calls (a variable declared outside loop keeps its value between calls). Compare it to the current reading each pass: only toggle on the specific HIGH-to-LOW transition, then update the remembered previous reading.',
            'Press the button several separate times before checking your work.',
          ],
          starterCode: `bool lastReading = true;  // HIGH = released
bool ledOn = false;

void setup() {
  pinMode(13, OUTPUT);
  pinMode(2, INPUT_PULLUP);
}

void loop() {
  // Read D2. If it just transitioned from HIGH to LOW, toggle ledOn.
  // Update lastReading, then write ledOn to D13.
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'toggles-per-press', label: 'Toggle D13 exactly once per press, not per press and release', rule: 'toggles-per-press' },
          ],
          hints: [
            'Detect the transition as: lastReading == HIGH && currentReading == LOW.',
            'Update lastReading to the current reading on every loop iteration, after the comparison — not only when a press is detected.',
            'digitalWrite(13, ledOn) belongs outside the transition check, so the LED always reflects the latest toggle even on iterations with no new press.',
          ],
        },
      ],
    },
    {
      id: 'one-press-many-transitions',
      title: 'One press, many transitions',
      description: 'A real mechanical switch bounces; filter the noise without losing real presses.',
      durationMinutes: 16,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Why bounce happens',
          paragraphs: [
            'A real mechanical switch does not close cleanly. As the metal contacts come together, they physically bounce apart and reconnect several times over a few milliseconds before settling. Electrically, this produces a rapid burst of extra HIGH-to-LOW-to-HIGH transitions — all from one physical press.',
            'Code that reacts to every transition, like the toggle from the previous lesson, would see that burst as several separate presses instead of one. The fix is debouncing: after accepting one transition as a real press, ignore further transitions for a short window — typically tens of milliseconds, long enough to outlast the bounce but short enough not to miss a genuinely fast second press.',
            'A simple, nonblocking debounce stores the millis() timestamp of the last accepted press. On each new transition, only accept it if enough time has passed since that stored timestamp — otherwise, treat it as bounce and ignore it without updating the timestamp.',
          ],
          takeaway: 'Debouncing accepts the first transition in a burst and ignores the rest for a short window.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Choose a debounce window',
          concept: 'debounce',
          paragraphs: [
            'This model replays a fixed raw trace from two physical presses. Adjust the debounce window and watch how many raw edges survive as accepted presses.',
            'Real switches vary; 20-50 ms comfortably covers most buttons without risking a missed fast press.',
          ],
          instruction: 'Set the window very low, then very high, and notice both failure modes: too many accepted presses, or real presses merged away.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'What a bad debounce window does',
          prompt: 'A press-counting sketch uses a debounce window of only 2 ms. The button\'s real bounce lasts about 15 ms. What happens when the button is pressed once?',
          options: [
            { id: 'counts-one', label: 'The count increases by exactly 1, since 2 ms is still a debounce window.' },
            { id: 'counts-several', label: 'The count increases by several, because most of the 15 ms bounce is outside the 2 ms window.' },
            { id: 'counts-zero', label: 'The count does not increase, because 2 ms is too short to register anything.' },
          ],
          answerId: 'counts-several',
          explanation: 'A window shorter than the real bounce duration lets most of the bounce\'s extra transitions through as if they were separate presses.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Count presses accurately',
          paragraphs: [
            'Report the number of real presses over Serial, accurately, even though the simulated button may bounce. Print the running count after each accepted press.',
            'Use millis() to time a debounce window of about 50 ms. On a HIGH-to-LOW transition, only accept it (increment the count and print it) if at least 50 ms have passed since the last accepted press.',
            'The check compares your printed count to the actual debounced press count computed from the real D2 signal your sketch produced — not a fixed script.',
          ],
          starterCode: `bool lastReading = true;
unsigned long lastAcceptedMs = 0;
int count = 0;

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
}

void loop() {
  bool reading = digitalRead(2);
  // On a HIGH-to-LOW transition more than 50 ms after the last accepted
  // press, increment count and print it. Always update lastReading.
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'debounced-count', label: 'Report the real debounced press count over Serial', rule: 'debounced-count' },
          ],
          hints: [
            'Detect the transition the same way as the previous lesson: lastReading was HIGH, reading is now LOW.',
            'Guard the transition with millis() - lastAcceptedMs >= 50. Only update lastAcceptedMs when you actually accept a press.',
            'Serial.println(count) after incrementing, so the latest printed number is always the current total.',
          ],
        },
      ],
    },
  ],
};
