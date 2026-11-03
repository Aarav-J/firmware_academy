import type { Course } from './types';
import { circuitUnit } from './circuit-course';
import { readInputsUnit } from './units/read-inputs';
import { observeAndDebugUnit } from './units/observe-and-debug';
import { makeItResponsiveUnit } from './units/make-it-responsive';
import { readAnalogSignalsUnit } from './units/read-analog-signals';
import { controlOutputsWithPwmUnit } from './units/control-outputs-with-pwm';
import { handleAsynchronousEventsUnit } from './units/handle-asynchronous-events';
import { talkToAnotherDeviceUnit } from './units/talk-to-another-device';
import { storeDataAcrossResetsUnit } from './units/store-data-across-resets';
import { finalProjectUnit } from './units/final-project';

export const arduinoCourse: Course = {
  id: 'arduino-fundamentals',
  title: 'Arduino fundamentals',
  description:
    'Turn familiar C statements into observable behavior on an Arduino Uno. Start with one LED, then build a mental model of execution, output state, and time.',
  audience: 'You know basic C. No electronics or embedded programming experience is needed.',
  board: 'Arduino Uno',
  units: [
    {
      id: 'meet-the-board',
      title: 'Meet the board',
      description:
        'Follow a sketch from startup to a running loop, control the built-in LED, and give its changes a rhythm. No external wiring needed.',
      lessons: [
        {
          id: 'first-output',
          title: 'Your first output',
          description: 'Meet setup and loop, then turn on the LED already on your board.',
          durationMinutes: 12,
          steps: [
            {
              id: 'introduction',
              kind: 'read',
              title: 'A program that lives on a board',
              paragraphs: [
                'A microcontroller is a small computer that runs your program and connects it to physical signals. On the Arduino Uno, the ATmega328P microcontroller can drive a pin HIGH or LOW. A pin is an electrical connection; a digital output has two intended logic states, not an arbitrary brightness.',
                'Arduino calls your program a sketch. The Arduino framework supplies the startup code: after power-on or reset, it calls setup() once, then calls loop() repeatedly. You write these two functions instead of writing main(). A reset starts this sequence again.',
                'Arduino sketches are compiled as C++. Your basic C knowledge still applies: statements, variables, functions, and control flow work here too. You do not need classes for these lessons. The void in void setup() and void loop() means these functions return no value.',
                'The Uno already has an LED labeled L connected to digital pin 13 (D13). The Arduino constant LED_BUILTIN names this pin. In these lessons, driving D13 HIGH as an output lights that LED; LOW turns it off. You do not need a breadboard or an external LED yet.',
              ],
              takeaway: 'After each reset: setup runs once, then loop runs over and over.',
            },
            {
              id: 'explore',
              kind: 'explore',
              title: 'Follow the execution order',
              concept: 'execution',
              paragraphs: [
                'Before writing a sketch, follow where control goes. Finishing setup does not stop the program: the framework moves on to loop. Finishing loop sends control back around for another call.',
                'This guided model illustrates the execution order. It is not a running microcontroller or a register debugger; the coding exercise uses the workbench to build and run your actual sketch.',
              ],
              instruction:
                'Advance through the model until you have seen setup once and loop more than once. Then reset it and notice that setup becomes the starting point again.',
            },
            {
              id: 'predict',
              kind: 'predict',
              title: 'What happens after setup?',
              prompt:
                'A sketch has completed setup(). Its loop() contains no statements. The board stays powered and is not reset. What does the Arduino framework do next?',
              options: [
                { id: 'repeat-setup', label: 'Call setup again each time the empty loop finishes.' },
                { id: 'repeat-loop', label: 'Keep calling the empty loop; setup does not run again.' },
                { id: 'stop-board', label: 'Stop the board because the sketch has no more work.' },
              ],
              answerId: 'repeat-loop',
              explanation:
                'The framework repeatedly calls loop, even when it is empty. setup runs once per startup or reset, not once per loop. This lets you put one-time configuration in setup and repeating behavior in loop.',
            },
            {
              id: 'exercise',
              kind: 'exercise',
              title: 'Light the built-in LED',
              paragraphs: [
                'Make the built-in LED on D13 turn on during setup and stay on. Build your sketch, then run it for at least one simulated second. Leave loop empty: repeated writes are not needed to hold a digital output HIGH.',
                'Configure the pin before driving it. The API void pinMode(uint8_t pin, uint8_t mode) selects a pin mode; pinMode(LED_BUILTIN, OUTPUT) makes the LED pin an output. Here uint8_t means an unsigned 8-bit value; the named Arduino constants provide the values you need.',
                'The API void digitalWrite(uint8_t pin, uint8_t value) sets a digital output to HIGH or LOW. For example, digitalWrite(LED_BUILTIN, LOW) turns this LED off once its pin is configured as an output. Choose the level that meets the goal instead.',
                'Use Build & run to compile your sketch and gather simulated evidence. A successful build means your program compiled; it does not by itself prove the LED behavior.',
              ],
              starterCode: `void setup() {
  // Configure the built-in LED pin as an output.
  // Give that output the level that lights the LED.
}

void loop() {
  // Nothing needs to repeat for a steady output.
}
`,
              goals: [
                { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
                {
                  id: 'steady-high',
                  label: 'Keep D13 HIGH for at least 1 simulated second',
                  rule: 'steady-high',
                },
              ],
              hints: [
                'Put one-time pin configuration and the initial output level in setup. An empty loop is valid.',
                'Call pinMode with LED_BUILTIN as the pin and OUTPUT as the mode before changing the level.',
                'Use digitalWrite on the same pin with HIGH. Then build and run long enough to observe at least one simulated second; you do not need to add a delay to keep the state.',
              ],
            },
          ],
        },
        {
          id: 'output-state',
          title: 'An output remembers',
          description: 'Separate a statement that changes state from the state that remains afterward.',
          durationMinutes: 12,
          steps: [
            {
              id: 'introduction',
              kind: 'read',
              title: 'A write changes state',
              paragraphs: [
                'A digital output is not a pulse that lasts only while digitalWrite is executing. The microcontroller retains the chosen output state after the function returns. With the pin still configured as an output, its level stays HIGH or LOW until something changes it or the board resets.',
                'The output state is held by hardware registers inside the microcontroller. You do not need to manipulate those registers directly: Arduino functions give you a readable interface. Calling digitalWrite once can therefore produce a lasting electrical effect.',
                'Time is another part of your program. The API void delay(unsigned long ms) waits for a number of milliseconds; delay(1000) waits about one second. Statements after that call run when the wait finishes, in their normal order.',
                'delay blocks the flow of your sketch: it does not proceed to the next statement during the wait. It does not pause all hardware. The configured output keeps its state, and hardware such as timers can continue working. That distinction will matter when we later want a responsive program.',
              ],
              takeaway: 'The CPU can wait or run other statements while a digital output holds its last state.',
            },
            {
              id: 'explore',
              kind: 'explore',
              title: 'Separate control flow from pin state',
              concept: 'digital-output',
              paragraphs: [
                'Changing a pin level and executing the next instruction are separate events. Watch the output state remain in place after a write rather than imagining that the LED needs a constant stream of HIGH commands.',
                'This simplified teaching model shows the idea of a retained digital output. Its illustrated state is not a measurement from the emulator or a live view of the Uno registers.',
              ],
              instruction:
                'Set the modeled output HIGH, then move forward without changing it. Notice what stays the same. Change it to LOW and compare the new state.',
            },
            {
              id: 'predict',
              kind: 'predict',
              title: 'During the wait',
              prompt:
                'D13 is configured as OUTPUT. In setup, the sketch writes HIGH, calls delay(1000), then writes LOW. loop is empty. What happens to the built-in LED during and after the delay?',
              options: [
                { id: 'off-while-waiting', label: 'It turns off during the delay because no instructions write HIGH.' },
                { id: 'repeat-after-wait', label: 'It stays on for a second, then repeats the same on/off sequence forever.' },
                { id: 'hold-then-off', label: 'It stays on during the delay, then turns off and stays off.' },
              ],
              answerId: 'hold-then-off',
              explanation:
                'The output holds HIGH throughout the wait. The next write changes it to LOW. Because the sequence is in setup, it happens once; the empty loop never changes the pin again.',
            },
            {
              id: 'exercise',
              kind: 'exercise',
              title: 'On once, then off',
              paragraphs: [
                'At sketch startup, configure D13 as an output and turn its built-in LED on. Keep it HIGH for 1000 milliseconds, then turn it LOW and leave it LOW. This sequence should happen only once after each reset.',
                'Use pinMode(pin, OUTPUT) to configure the pin, digitalWrite(pin, HIGH or LOW) to choose its state, and delay(milliseconds) to separate the changes in time. Use LED_BUILTIN consistently for the pin.',
                'Think about which function owns a one-time sequence. Once the LED goes off, there should be no later instruction that turns it on again. Use Build & run and observe at least two simulated seconds: one second HIGH followed by at least one second LOW, so the checker can observe both parts.',
              ],
              starterCode: `void setup() {
  // Configure the built-in LED output.
  // Turn it on, wait one second, then turn it off.
}

void loop() {
  // The one-time sequence must not restart here.
}
`,
              goals: [
                { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
                {
                  id: 'delayed-low',
                  label: 'Start D13 HIGH, switch LOW after 1000 ms, and stay LOW',
                  rule: 'delayed-low',
                },
              ],
              hints: [
                'The behavior is one-time, so put the sequence in setup rather than loop.',
                'After configuring the pin, write HIGH before the wait and LOW after it. The output holds its state during the wait.',
                'One second is 1000 milliseconds, so the wait is delay(1000). Leave loop empty so nothing later reverses the final LOW state.',
              ],
            },
          ],
        },
        {
          id: 'blink-timing',
          title: 'Give the loop a rhythm',
          description: 'Compose a repeating signal from two output levels and two waits.',
          durationMinutes: 15,
          steps: [
            {
              id: 'introduction',
              kind: 'read',
              title: 'One loop, one cycle',
              paragraphs: [
                'To blink continuously, put the repeating changes in loop. A useful way to read the program is as a timeline: choose HIGH, wait, choose LOW, wait. When loop finishes, Arduino calls it again and the next cycle begins.',
                'Each wait determines how long the preceding level is held. For example, delay(200) after a HIGH write holds that HIGH interval for about 200 milliseconds. Changing a delay changes the time between transitions, not the meaning of HIGH or LOW.',
                'A blink with 250 milliseconds HIGH and 750 milliseconds LOW has a nominal period of 1000 milliseconds: one cycle each second, or 1 hertz. It is on for one quarter of the cycle, a 25% duty cycle. The real transitions also include the small execution time of the surrounding instructions.',
                'Using delay is a clear first way to express a rhythm, but your sketch cannot handle other work between statements while it waits. The output and other hardware do not all freeze. A later unit introduces timing with millis so your sketch can remain responsive.',
              ],
              takeaway: 'A repeating signal needs both an on interval and an off interval; their sum is the cycle time.',
            },
            {
              id: 'explore',
              kind: 'explore',
              title: 'Read the signal as a timeline',
              concept: 'timing',
              paragraphs: [
                'The width of each HIGH or LOW segment represents time spent at that level. A short on interval followed by a long off interval produces a brief flash, even when the full cycle still lasts one second.',
                'This timeline is a conceptual timing illustration, not a captured trace from your sketch. In the exercise, run the program and use the workbench observations to check the actual simulated transitions.',
              ],
              instruction:
                'Compare the HIGH and LOW intervals in the timing model. Find the start of the next cycle and use both intervals to work out the total cycle time.',
            },
            {
              id: 'predict',
              kind: 'predict',
              title: 'How often does the flash repeat?',
              prompt:
                'In each call to loop, a sketch drives the LED HIGH for 250 ms and then LOW for 750 ms. Ignore the tiny instruction overhead. Which description matches the repeating signal?',
              options: [
                { id: 'one-second-quarter', label: 'One cycle per second, with the LED on for 25% of each cycle.' },
                { id: 'four-cycles', label: 'Four cycles per second, because the HIGH interval lasts 250 ms.' },
                { id: 'one-second-three-quarters', label: 'One cycle per second, with the LED on for 75% of each cycle.' },
              ],
              answerId: 'one-second-quarter',
              explanation:
                'Count the entire cycle, not just the time the LED is on. 250 + 750 = 1000 ms, so a cycle takes one second. The HIGH portion is 250 / 1000 = 25%.',
            },
            {
              id: 'exercise',
              kind: 'exercise',
              title: 'A short flash, a longer pause',
              paragraphs: [
                'Make the built-in LED blink continuously: HIGH for 250 milliseconds, then LOW for 750 milliseconds, repeating in that order. Configure D13 as an output once in setup; express the repeating sequence in loop.',
                'Use digitalWrite(LED_BUILTIN, level) to change the level and delay(milliseconds) after each change to hold it. Both the on time and the off time matter. Waiting only after HIGH would make the LOW interval almost too short to see.',
                'Build and run for several simulated seconds. Look for multiple complete cycles with the requested durations, not just an LED that happens to be lit when you look. Small instruction overhead is normal; the requested waits should still be 250 ms and 750 ms.',
              ],
              starterCode: `void setup() {
  // Configure the built-in LED pin once.
}

void loop() {
  // Create the short HIGH interval.
  // Create the longer LOW interval.
  // Arduino repeats this function for you.
}
`,
              goals: [
                { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
                {
                  id: 'timed-blink',
                  label: 'Repeat D13 HIGH for 250 ms and LOW for 750 ms',
                  rule: 'timed-blink',
                },
              ],
              hints: [
                'Only pin configuration belongs in setup. The two level changes and their waits belong in loop.',
                'Think in pairs: write HIGH, then wait for the on interval; write LOW, then wait for the off interval.',
                'Use delay(250) after the HIGH write and delay(750) after the LOW write. You do not need another loop statement: Arduino calls loop repeatedly.',
              ],
            },
          ],
        },
      ],
    },
    circuitUnit,
    readInputsUnit,
    observeAndDebugUnit,
    makeItResponsiveUnit,
    readAnalogSignalsUnit,
    controlOutputsWithPwmUnit,
    handleAsynchronousEventsUnit,
    talkToAnotherDeviceUnit,
    storeDataAcrossResetsUnit,
    finalProjectUnit,
  ],
};
