import type { CourseUnit } from '../types';

export const observeAndDebugUnit: CourseUnit = {
  id: 'observe-and-debug',
  title: 'Observe and debug',
  description: 'Use evidence to explain what a circuit and sketch are actually doing, instead of guessing.',
  lessons: [
    {
      id: 'make-internal-state-visible',
      title: 'Make internal state visible',
      description: 'Serial.println turns invisible program state into something you can actually see.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'You cannot watch variables from the outside',
          paragraphs: [
            'An Uno has no screen. A variable like your debounced press count exists only inside the chip\'s memory — you cannot see it by looking at the board. The only two windows into what firmware is actually doing are its pin outputs and Serial.',
            'Serial.begin(baud) starts the connection; Serial.print() and Serial.println() send text back to your computer. Printing a variable\'s value at a meaningful moment — after a decision, inside a branch, when a count changes — turns an invisible fact into visible evidence.',
            'Logging is not free: Serial.print() takes real time to transmit, and printing on every single loop() iteration can flood the output and even change timing-sensitive behavior. Print at meaningful events, not continuously.',
          ],
          takeaway: 'If you cannot see a value, you are guessing about it — print it instead.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Guessing versus logging',
          concept: 'serial-trace',
          paragraphs: [
            'Compare trying to know what happened with no log, against reading a log of exactly what your code decided.',
          ],
          instruction: 'Press the button a few times and watch how the right-hand log makes each decision visible, one line per accepted event.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'What should get logged?',
          prompt: 'You are debugging why a press counter sometimes seems to miss presses. Which logging choice gives you the clearest evidence?',
          options: [
            { id: 'log-every-loop', label: 'Print the raw digitalRead() value on every single loop() iteration.' },
            { id: 'log-accepted', label: 'Print a line only when a press is accepted as a debounced event.' },
            { id: 'log-nothing', label: 'Add no logging, and reason about it from the code alone.' },
          ],
          answerId: 'log-accepted',
          explanation: 'Logging only accepted events keeps the output readable and shows you exactly what your code decided happened — the thing you actually need to verify.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Log every accepted press',
          paragraphs: [
            'Debounce the D2 button as in the previous unit, but this time log a readable event instead of a bare number: print a line containing the word "Press" for every accepted, debounced press — nothing printed for bounce or for a held button.',
            'This proves your debounce logic is accepting the right events, not just producing a plausible final count.',
          ],
          starterCode: `bool lastReading = true;
unsigned long lastAcceptedMs = 0;

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
}

void loop() {
  bool reading = digitalRead(2);
  // On an accepted, debounced HIGH-to-LOW transition, print a line
  // containing the word "Press".
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'reports-events', label: 'Log exactly one "Press" line per debounced press', rule: 'reports-events' },
          ],
          hints: [
            'Reuse the debounce condition from the previous lesson: lastReading was HIGH, reading is LOW, and at least 50 ms have passed since the last accepted press.',
            'Serial.println("Press") is enough — the check looks for the word, not an exact format.',
            'Press the button several separate times, with real gaps between presses, before checking your work.',
          ],
        },
      ],
    },
    {
      id: 'follow-the-evidence',
      title: 'Follow the evidence',
      description: 'A symptom has more than one possible cause; use behavior to tell them apart.',
      durationMinutes: 16,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Three places a bug can hide',
          paragraphs: [
            'When a circuit does not behave as expected, the cause is one of three categories: a wiring problem (the physical connection is wrong or missing), a configuration problem (pinMode or a setting does not match the real wiring), or a logic problem (the connections and configuration are correct, but the code\'s decision is wrong).',
            'These categories produce different symptoms. A wiring problem usually makes an input read as if nothing is connected. A configuration problem — like leaving out INPUT_PULLUP — can make an input read an unexpected, possibly inverted, level. A logic problem usually makes the board do something, just the wrong something: an inverted condition, for example, turns an LED on exactly when it should be off.',
            'The fastest way to tell them apart is to log the raw input you are reading. If the raw reading already looks wrong given how you expect the button to behave, suspect wiring or configuration. If the raw reading looks correct but the output decision is wrong, suspect logic.',
          ],
          takeaway: 'Log the raw input before concluding the output logic is broken — the input fact might be the actual problem.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Read the handler and the instructions together',
          concept: 'edge-event',
          paragraphs: [
            'This reuses the state-versus-event model from the previous unit: the same transition logic is what the buggy sketch in this lesson\'s exercise is supposed to implement.',
            'Keep the correct transition rule in mind — previous reading HIGH, current reading LOW — as you read the supplied sketch in the next step.',
          ],
          instruction: 'Step through the sequence once more. You will compare this correct rule against a sketch that gets it backward.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Read the bug before you run it',
          prompt: 'A supplied sketch toggles the LED with: if (digitalRead(2) == HIGH) { ledOn = !ledOn; }. The button is wired active-low, as usual. What will actually happen when you run it?',
          options: [
            { id: 'toggles-on-press', label: 'It toggles correctly once per press, since HIGH is a valid condition to check.' },
            { id: 'toggles-continuously', label: 'It toggles on every loop iteration the button is released, not on the press.' },
            { id: 'never-toggles', label: 'It never toggles, because HIGH never occurs on this pin.' },
          ],
          answerId: 'toggles-continuously',
          explanation: 'The condition checks a level (HIGH, meaning released) every iteration, not a transition. Since loop() runs continuously while released, this toggles far more often than once per press — and misses the actual press (LOW) entirely.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Repair the inverted condition',
          paragraphs: [
            'The supplied sketch has exactly the logic fault from the prediction above: it checks the released level repeatedly, instead of detecting the pressed transition. Fix it so D13 toggles exactly once per real press.',
            'The wiring and pin configuration are already correct — this is a logic-only repair. Do not change pinMode or add external wiring.',
          ],
          starterCode: `bool lastReading = true;
bool ledOn = false;

void setup() {
  pinMode(13, OUTPUT);
  pinMode(2, INPUT_PULLUP);
}

void loop() {
  // Bug: this checks the released level every iteration, not the
  // pressed transition. Replace it with a correct edge check using
  // lastReading, matching the pattern from the previous unit.
  if (digitalRead(2) == HIGH) {
    ledOn = !ledOn;
  }
  digitalWrite(13, ledOn);
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'toggles-per-press', label: 'Toggle D13 exactly once per real press', rule: 'toggles-per-press' },
          ],
          hints: [
            'The fix is the same transition check from the previous unit: compare the current reading to a remembered lastReading, and only act on HIGH-to-LOW.',
            'Remember to update lastReading to the current reading on every loop iteration, after the comparison.',
            'digitalWrite(13, ledOn) should still run every loop iteration so the LED always reflects the latest toggle.',
          ],
        },
      ],
    },
    {
      id: 'debug-a-small-system',
      title: 'Debug a small system',
      description: 'Isolate one subsystem at a time instead of changing everything at once.',
      durationMinutes: 16,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Change one thing, then check',
          paragraphs: [
            'When more than one thing might be wrong, changing several things at once makes it impossible to know which change actually fixed the problem — or whether a new change introduced a different one. Isolate: form a specific hypothesis about one fault, make the smallest change that tests it, then check the result before moving on.',
            'A useful order: check configuration first (does pinMode match the real wiring?), then check the raw input reading (does it behave as the hardware should produce?), then check the logic (does the code\'s decision follow correctly from a confirmed-correct input?).',
            'This lesson\'s exercise has two independent faults: a configuration fault and a logic fault. Fixing only one will not produce fully correct behavior — but confirming each fix separately, in order, is exactly the isolate-and-verify process this lesson teaches.',
          ],
          takeaway: 'Fix and verify one suspected fault at a time; do not change everything and hope.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Compare pull-up and floating readings again',
          concept: 'pull-up-input',
          paragraphs: [
            'This reuses the pull-up model from the first lesson of the previous unit.',
            'Keep the floating-input risk in mind: the exercise ahead has a pin configured without the pull-up it needs.',
          ],
          instruction: 'Switch to plain INPUT once more and notice the reading becomes unreliable — this is the configuration fault you will diagnose next.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Which fault explains which symptom?',
          prompt: 'A button-controlled LED never turns on, no matter how the button is pressed. pinMode was set to plain INPUT instead of INPUT_PULLUP. What is the most likely immediate cause?',
          options: [
            { id: 'logic-only', label: 'The toggle logic itself must be wrong; the pin configuration is unrelated.' },
            { id: 'floating-read', label: 'Without a pull-up, the pin reading is unreliable, so a transition-based check may rarely or never see the expected pattern.' },
            { id: 'hardware-dead', label: 'The onboard button hardware itself has likely failed.' },
          ],
          answerId: 'floating-read',
          explanation: 'A missing pull-up leaves the input floating. An edge-detection check depends on a clean, predictable HIGH/LOW signal — a floating pin cannot reliably produce one, even if the toggle logic itself is correct.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Satisfy the specification',
          paragraphs: [
            'The supplied sketch has a configuration fault (no pull-up) and a logic fault (same inverted condition as the previous lesson). Fix both so D13 toggles exactly once per real press.',
            'Work in order: fix the pin configuration first, then the toggle logic. Checking your work after each change — even though only the final result is graded — will tell you whether each fix actually helped.',
          ],
          starterCode: `bool lastReading = true;
bool ledOn = false;

void setup() {
  pinMode(13, OUTPUT);
  // Configuration fault: this pin needs its internal pull-up enabled.
  pinMode(2, INPUT);
}

void loop() {
  // Logic fault: same inverted, level-based check as before.
  if (digitalRead(2) == HIGH) {
    ledOn = !ledOn;
  }
  digitalWrite(13, ledOn);
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'toggles-per-press', label: 'Toggle D13 exactly once per real press', rule: 'toggles-per-press' },
          ],
          hints: [
            'Start with pinMode(2, INPUT_PULLUP) — the same fix from the first lesson of the previous unit.',
            'Then apply the edge-detection fix from the previous lesson: compare against a remembered lastReading instead of checking a level.',
            'Both fixes are needed together. Fixing only one will not reliably produce one toggle per press.',
          ],
        },
      ],
    },
  ],
};
