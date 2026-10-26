import type { CourseUnit } from '../types';

export const handleAsynchronousEventsUnit: CourseUnit = {
  id: 'handle-asynchronous-events',
  title: 'Handle asynchronous events',
  description: 'Respond to events without losing track of shared state, using a real hardware interrupt.',
  lessons: [
    {
      id: 'polling-versus-interrupts',
      title: 'Polling versus interrupts',
      description: 'An interrupt notices an edge the instant it happens, even between loop() iterations.',
      durationMinutes: 16,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Let the hardware notify you',
          paragraphs: [
            'Every exercise so far has polled: loop() calls digitalRead() on its own schedule and hopes it catches a transition before the pin changes again. For a human pressing a button, loop() running thousands of times a second easily keeps up — but polling still means the CPU spends time repeatedly asking a question that is usually "no."',
            'The ATmega328P can instead notify your code the moment a specific transition happens, by executing a dedicated function — an interrupt service routine (ISR) — regardless of what loop() was doing at that instant. D2 is wired to INT0, one of the chip\'s hardware interrupt lines.',
            'attachInterrupt(digitalPinToInterrupt(pin), handlerFunction, mode) registers that function. mode is typically FALLING (trigger on HIGH-to-LOW, matching our active-low button) or RISING or CHANGE. The handler function must take no arguments and return nothing.',
          ],
          takeaway: 'An interrupt handler runs exactly when the hardware event happens, not on loop()\'s next pass.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Step through an interrupt',
          concept: 'interrupt-handler',
          paragraphs: [
            'Step through the sequence: normal execution, the pause, the handler, and the exact resume point.',
          ],
          instruction: 'Advance through all four stages and notice execution resumes exactly where it paused.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'When does the handler run?',
          prompt: 'loop() is in the middle of a long calculation (no delay(), just ordinary instructions) when a FALLING edge occurs on D2, which has an attached interrupt. When does the handler run?',
          options: [
            { id: 'after-loop', label: 'Only after the current loop() iteration finishes.' },
            { id: 'almost-immediately', label: 'Almost immediately — execution pauses mid-calculation, runs the handler, then resumes exactly where it left off.' },
            { id: 'needs-poll', label: 'Only once code explicitly calls digitalRead() to check for it.' },
          ],
          answerId: 'almost-immediately',
          explanation: 'A hardware interrupt pauses execution at (almost) any point, not just between loop() iterations — that is the entire point of using one instead of polling.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Count presses with a real interrupt',
          paragraphs: [
            'Attach an interrupt to D2 that counts every real falling edge, and report the count over Serial. Unlike the polling exercises earlier, this does not need a debounce window — the check expects every real edge, including from a bouncing switch, since that is genuinely what a bare interrupt handler sees.',
            'Declare the counter volatile — a keyword telling the compiler this variable can change at any time due to the interrupt, so it must always re-read it from memory rather than assuming a cached value is still current.',
          ],
          starterCode: `volatile int count = 0;

void onEdge() {
  count++;
}

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
  // Attach onEdge to D2's interrupt, triggered on FALLING.
}

void loop() {
  // Print count whenever it changes.
  static int lastPrinted = -1;
  if (count != lastPrinted) {
    lastPrinted = count;
    Serial.println(count);
  }
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'interrupt-count', label: 'Report the real number of falling edges on D2', rule: 'interrupt-count' },
          ],
          hints: [
            'attachInterrupt(digitalPinToInterrupt(2), onEdge, FALLING); belongs in setup(), after pinMode.',
            'count must be declared volatile, as shown in the starter code — it already is.',
            'This exercise counts raw edges, not debounced presses. A bouncing simulated press is expected to count every edge.',
          ],
        },
      ],
    },
    {
      id: 'keep-the-handler-short',
      title: 'Keep the handler short',
      description: 'A slow handler delays everything else — including other interrupts and your main loop.',
      durationMinutes: 16,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'An interrupt handler borrows the whole CPU',
          paragraphs: [
            'While an interrupt handler runs, loop() is paused — and by default, other interrupts are disabled too. A handler that does real work (reading sensors, long computation, certainly delay()) can noticeably delay everything else that depends on timing, including a concurrent millis()-based blink.',
            'The correct habit: let the handler do the minimum possible — usually just recording that an event happened, such as incrementing a volatile counter — and do any heavier processing back in loop(), where it belongs and where other interrupts are not disabled.',
            'This exercise proves the point by combining two things you have already built: an interrupt-counted button and a millis()-based blink. If your handler is short and your blink logic is correctly nonblocking, both keep working correctly at the same time.',
          ],
          takeaway: 'A short handler protects both the rest of your program and any other interrupts from being delayed.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'The same pause-and-resume model',
          concept: 'interrupt-handler',
          paragraphs: [
            'This reuses the previous lesson\'s model. The point this time: imagine the handler stage taking noticeably longer, and consider what that delays.',
          ],
          instruction: 'Step through once more, and picture the "handling" stage lasting much longer than a few instructions.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'What a slow handler breaks',
          prompt: 'A sketch blinks an LED with millis() and also counts button presses with an interrupt. The interrupt handler calls delay(50) before returning. What is the most likely visible effect?',
          options: [
            { id: 'no-effect', label: 'No effect — the blink and the interrupt are completely independent.' },
            { id: 'blink-stalls', label: 'The blink can visibly stall or run late whenever a press happens, since the whole program is paused during the handler.' },
            { id: 'count-wrong', label: 'The press count becomes permanently wrong, but the blink is unaffected.' },
          ],
          answerId: 'blink-stalls',
          explanation: 'Nothing else runs while the handler is executing, including the millis()-based blink check. A 50 ms delay inside the handler delays the blink by that same amount.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Blink and count at the same time',
          paragraphs: [
            'Blink D13 with a 250 ms HIGH / 750 ms LOW pattern using millis(), while an interrupt on D2 counts every falling edge and reports the count over Serial, exactly as in the previous lesson.',
            'If the interrupt handler does only minimal work, the blink keeps its exact schedule even while presses are happening. Keep all other processing — including the Serial.println — in loop(), not inside the handler.',
          ],
          starterCode: `const int LED = 13;
unsigned long previousBlinkMs = 0;
bool blinkHigh = false;

volatile int count = 0;

void onEdge() {
  count++;
}

void setup() {
  Serial.begin(9600);
  pinMode(LED, OUTPUT);
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), onEdge, FALLING);
}

void loop() {
  // Blink LED on a 250 ms HIGH / 750 ms LOW schedule using millis().

  static int lastPrinted = -1;
  if (count != lastPrinted) {
    lastPrinted = count;
    Serial.println(count);
  }
}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'interrupt-count', label: 'Report the real number of falling edges on D2', rule: 'interrupt-count' },
            { id: 'timed-blink', label: 'Keep D13 blinking 250 ms HIGH / 750 ms LOW even while presses occur', rule: 'timed-blink', pin: 13, highMs: 250, lowMs: 750 },
          ],
          hints: [
            'The blink logic is the same millis() pattern from the Make it responsive unit.',
            'The interrupt handler should do nothing but count++; — everything else, including printing, stays in loop().',
            'Press the button a few times while the blink is running, then check your work.',
          ],
        },
      ],
    },
  ],
};
