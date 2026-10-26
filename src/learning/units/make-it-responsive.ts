import type { CourseUnit } from '../types';

export const makeItResponsiveUnit: CourseUnit = {
  id: 'make-it-responsive',
  title: 'Make it responsive',
  description: 'Keep time without making every other task wait — the central turning point of this course.',
  lessons: [
    {
      id: 'why-delay-becomes-a-problem',
      title: 'Why delay() becomes a problem',
      description: 'delay() pauses your entire program, including the ability to notice a button press.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'A blocked program cannot also check a button',
          paragraphs: [
            'delay(ms) does exactly what its name says: your program stops at that line and does nothing else until the time passes. That includes not calling digitalRead() again, not checking Serial, not running any other logic in loop() — the entire sketch is frozen.',
            'The button hardware itself still reacts instantly; the Uno is just not looking. If someone presses and releases the button entirely inside a delay(900) call, your code never sees it happen. The event is not delayed — it is missed completely.',
            'This is invisible in small examples because delays are often short and presses are rare in a demo. It becomes a real bug the moment your program needs to do more than one thing — like blink a light and also stay responsive to input.',
          ],
          takeaway: 'Time spent inside delay() is time your program cannot check anything else, including a button.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Catch the button at different moments',
          concept: 'blocking-delay',
          paragraphs: [
            'This model shows one delay(1000) call inside loop(). Move the press earlier or later and see whether it falls inside the blocked window.',
          ],
          instruction: 'Slide the press time across the full range and read the explanation at each position.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Where does a press go unnoticed?',
          prompt: 'loop() runs digitalRead(2), then delay(900), then repeats. A press happens exactly 300 ms after a loop iteration started reading the button. What happens?',
          options: [
            { id: 'seen-immediately', label: 'It is seen immediately, since digitalRead() runs continuously.' },
            { id: 'seen-after-delay', label: 'It is missed until the current delay(900) finishes, then the next digitalRead() may or may not still see it.' },
            { id: 'causes-interrupt', label: 'The press automatically interrupts delay() and digitalRead() runs right away.' },
          ],
          answerId: 'seen-after-delay',
          explanation: 'A plain delay() call does not get interrupted by a button press. digitalRead() only runs again once delay() finishes and loop() reaches that line.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Remove the blocking wait',
          paragraphs: [
            'The supplied sketch toggles D13 once per press, correctly, but also calls delay(900) on every loop iteration for no real reason. Remove or restructure that delay so a press is noticed quickly, no matter when it happens.',
            'For this exercise, simply deleting the unnecessary delay is a complete, correct fix — you do not need millis() yet. The next lesson introduces the technique for when you genuinely do need timed behavior running at the same time as responsive input.',
          ],
          starterCode: `bool lastReading = true;
bool ledOn = false;

void setup() {
  pinMode(13, OUTPUT);
  pinMode(2, INPUT_PULLUP);
}

void loop() {
  bool reading = digitalRead(2);
  if (lastReading == HIGH && reading == LOW) {
    ledOn = !ledOn;
  }
  lastReading = reading;
  digitalWrite(13, ledOn);
  delay(900);  // Remove this: it blocks the button check for 900 ms every pass.
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'responsive-under-load', label: 'Respond to a press within 50 ms, even if it happens at any time', rule: 'responsive-under-load' },
          ],
          hints: [
            'The toggle logic is already correct — the only problem is the delay(900) line.',
            'Deleting that one line is enough to pass this exercise.',
            'Press the button a few separate times before checking your work, so the check can measure the actual response latency.',
          ],
        },
      ],
    },
    {
      id: 'track-elapsed-time',
      title: 'Track elapsed time',
      description: 'millis() lets you wait for a duration without blocking anything else.',
      durationMinutes: 18,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Check the clock instead of stopping it',
          paragraphs: [
            'unsigned long millis() returns the number of milliseconds since the board started, and it keeps counting no matter what your code is doing. Instead of stopping the program to wait, you can record a timestamp and repeatedly check how much time has passed — letting loop() keep doing everything else in between checks.',
            'The pattern: remember unsigned long previousMs = millis() at the start of a timed interval. On every loop iteration, compute unsigned long elapsed = millis() - previousMs. When elapsed is at least your target interval, perform the timed action and reset previousMs = millis() for the next interval.',
            'Subtracting two unsigned long values this way is safe even when millis() eventually wraps back to 0 after about 49 days — unsigned subtraction wraps correctly too, so elapsed still comes out correct. This is why the pattern uses subtraction, not direct comparison of millis() to a future target time.',
          ],
          takeaway: 'Comparing elapsed time on every pass through loop() replaces a blocking wait with a check that never stops anything else.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Step through an elapsed-time check',
          concept: 'millis-timing',
          paragraphs: [
            'Advance the clock and watch when the elapsed-time check becomes true.',
          ],
          instruction: 'Click the step button repeatedly until the check fires, then run the timed action and watch previousMillis reset.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Does the button still get checked?',
          prompt: 'A sketch uses millis() to blink an LED every 250 ms, with no delay() calls anywhere. A button press happens between two scheduled blink updates. What happens to the button check that same loop iteration?',
          options: [
            { id: 'waits-for-blink', label: 'It waits until the next scheduled blink update before running.' },
            { id: 'runs-immediately', label: 'It runs on this same loop iteration, since nothing is blocking execution.' },
            { id: 'needs-interrupt', label: 'It requires a hardware interrupt to be noticed at all.' },
          ],
          answerId: 'runs-immediately',
          explanation: 'Without a blocking delay() anywhere, loop() keeps cycling continuously. The elapsed-time check for the blink is just one more ordinary check — it does not stop the rest of loop() from running on every pass.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Blink and stay responsive at the same time',
          paragraphs: [
            'Blink D13 with a 250 ms HIGH / 750 ms LOW pattern using millis(), the same timing from the very first unit — but now you must also toggle D12 once per debounced press on D2, without the blink ever pausing to wait.',
            'Use two independent millis()-based (or event-based) pieces of state: one tracking the blink\'s timing, one tracking the button\'s debounce and toggle. Neither should block the other.',
          ],
          starterCode: `const int LED = 13;
const int RESPONSE = 12;
unsigned long previousBlinkMs = 0;
bool blinkHigh = false;

bool lastReading = true;
unsigned long lastAcceptedMs = 0;
bool responseOn = false;

void setup() {
  pinMode(LED, OUTPUT);
  pinMode(RESPONSE, OUTPUT);
  pinMode(2, INPUT_PULLUP);
}

void loop() {
  // Blink LED on a 250 ms HIGH / 750 ms LOW schedule using millis(),
  // without ever calling delay().

  // Separately, debounce D2 (50 ms window) and toggle RESPONSE once
  // per accepted press.
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'timed-blink', label: 'Blink D13 with 250 ms HIGH / 750 ms LOW using millis()', rule: 'timed-blink', pin: 13, highMs: 250, lowMs: 750 },
            { id: 'responsive-under-load', label: 'Toggle D12 within 50 ms of each press, even while blinking', rule: 'responsive-under-load', pin: 12 },
          ],
          hints: [
            'The blink timing is the same 250/750 pattern from the first unit, just using millis() instead of delay(). Track previousBlinkMs and the current level separately, switching durations based on which level is active.',
            'The button handling reuses the debounce pattern from the Read inputs unit: compare to lastReading, require 50 ms since lastAcceptedMs, then toggle RESPONSE.',
            'Neither piece of state should affect the other — the blink keeps its own timestamp, the button keeps its own.',
          ],
        },
      ],
    },
    {
      id: 'give-behavior-explicit-states',
      title: 'Give behavior explicit states',
      description: 'Name what the device is doing right now, so "busy — ignore this" becomes a deliberate rule.',
      durationMinutes: 16,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Not every input should do something immediately',
          paragraphs: [
            'Sometimes a device is already in the middle of responding and a new input should be ignored, not queued or restarted. A pedestrian crossing button does nothing while the walk signal is already active — pressing it again does not make the light change faster or extend the window.',
            'Writing this directly with a boolean flag works for one case, but becomes unclear fast. Naming the actual states explicitly — Idle, Active, Cooldown — and writing one rule for each transition makes the "ignore this for now" behavior intentional and easy to verify, rather than an accident of how the code happened to be structured.',
            'The pattern: a variable holding the current state, updated only by specific transitions (an event moves it forward, a timeout moves it forward), with each piece of logic checking which state it is currently in before acting.',
          ],
          takeaway: 'Naming states explicitly turns "ignore input while busy" into a rule you wrote on purpose.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Press during each state',
          concept: 'state-machine',
          paragraphs: [
            'Try pressing while Active — notice it does nothing until Cooldown finishes and the state returns to Idle.',
          ],
          instruction: 'Press once to go Active, then press again before finishing Cooldown and observe nothing changes.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'What should a second press do?',
          prompt: 'A device is Active, 300 ms into a required 1000 ms active window, when a second press arrives. What should correctly happen?',
          options: [
            { id: 'restart-window', label: 'The active window restarts, giving a fresh 1000 ms from this new press.' },
            { id: 'extends-window', label: 'The active window extends by another 1000 ms on top of the remaining time.' },
            { id: 'ignored', label: 'The press is ignored; the window still ends 1000 ms after the original press.' },
          ],
          answerId: 'ignored',
          explanation: 'While Active, the device is already responding to the first press. A correct state machine treats the second press as having no effect, rather than restarting or extending the timer.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Build a one-shot responder',
          paragraphs: [
            'Make D13 go HIGH for exactly 1000 ms after each accepted press on D2, then return LOW automatically, without using delay(). A press that happens while D13 is already HIGH must be ignored — it must not restart or extend the 1000 ms window.',
            'Use an explicit state variable (for example: an enum or a small set of named constants for Idle, Active, Cooldown) rather than trying to track everything with a single boolean.',
          ],
          starterCode: `enum State { IDLE, ACTIVE };
State state = IDLE;
bool lastReading = true;
unsigned long activeStartMs = 0;
const unsigned long ACTIVE_MS = 1000;

void setup() {
  pinMode(13, OUTPUT);
  pinMode(2, INPUT_PULLUP);
}

void loop() {
  bool reading = digitalRead(2);
  bool pressed = (lastReading == HIGH && reading == LOW);
  lastReading = reading;

  // If IDLE and pressed: move to ACTIVE, record activeStartMs, set D13 HIGH.
  // If ACTIVE and 1000 ms have elapsed since activeStartMs: move to IDLE, set D13 LOW.
  // A press while ACTIVE should have no additional effect.
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'state-sequence', label: 'Produce a clean 1000 ms active window per press, ignoring presses during it', rule: 'state-sequence', pin: 13, highMs: 1000 },
          ],
          hints: [
            'Only transition from IDLE to ACTIVE on a genuinely new press; once ACTIVE, presses should have no code path that changes activeStartMs.',
            'Check the elapsed-time condition the same way as the millis() lesson: millis() - activeStartMs >= ACTIVE_MS.',
            'Press the button once, wait for it to finish, then press again — and also try pressing a second time while still Active — before checking your work.',
          ],
        },
      ],
    },
  ],
};
