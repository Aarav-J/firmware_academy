import type { CourseUnit } from '../types';

export const storeDataAcrossResetsUnit: CourseUnit = {
  id: 'store-data-across-resets',
  title: 'Store data across resets',
  description: 'Keep a value alive through a reset using real persistent storage, not an ordinary variable.',
  lessons: [
    {
      id: 'remember-a-value',
      title: 'Remember a value across a reset',
      description: 'Write to real EEPROM, then prove it outlives a reset while an ordinary variable would not.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Two kinds of memory, two lifetimes',
          paragraphs: [
            'Every ordinary variable your sketch declares lives in SRAM — fast, byte-addressable memory powered by the chip\'s logic supply. The instant the chip resets or loses power, SRAM\'s content is gone; setup() runs from scratch with every variable back at its initial value.',
            'The ATmega328P also has a separate 1 KB block of EEPROM: slower, byte-addressable, nonvolatile memory that keeps its content with no power at all. A value a sketch writes to EEPROM is still there the next time that chip boots — after a reset, after a new sketch is flashed, even after the board sits unplugged on a shelf.',
            'Arduino\'s <EEPROM.h> library wraps this directly: EEPROM.read(address) returns the byte stored at that address, EEPROM.write(address, value) stores one. EEPROM.update(address, value) does the same job as write(), but skips the actual write if the byte is already correct — worth using, since each individual EEPROM cell only tolerates roughly 100,000 write cycles before it wears out.',
            'A brand-new, never-written EEPROM cell does not read as 0. Like erased flash, it reads as 0xFF (255) — every bit set. That specific, checkable value is exactly how a sketch tells "nothing has been saved yet" apart from "a value of zero was deliberately saved."',
          ],
          takeaway: 'EEPROM.write()/update() store a byte that survives a reset; SRAM variables do not. Erased EEPROM reads as 0xFF, not 0.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Watch SRAM and EEPROM diverge',
          concept: 'eeprom-persistence',
          paragraphs: [
            'Write a value, then simulate a reset, and watch which memory remembers it.',
          ],
          instruction: 'Write a value, simulate a reset, then write a second value and simulate another reset — SRAM resets to empty every time; EEPROM only ever shows the most recently written value.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'What does a fresh EEPROM cell read as?',
          prompt: 'A brand-new ATmega328P has never had EEPROM.write() called on address 0. What does EEPROM.read(0) return before any write happens?',
          options: [
            { id: 'zero', label: '0 — uninitialized memory defaults to zero, the same as a fresh SRAM variable.' },
            { id: 'erased', label: '0xFF (255) — erased EEPROM reads as all 1 bits, not 0.' },
            { id: 'random', label: 'A random value that differs every time the chip powers up.' },
            { id: 'negative', label: '-1, since EEPROM.read() returns a signed value by default.' },
          ],
          answerId: 'erased',
          explanation: 'Erased EEPROM cells read as 0xFF (255), exactly like erased flash — not 0. That specific value is the real, checkable signal a sketch uses to tell "nothing saved yet" apart from a deliberately saved zero.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Save a value that survives a reset',
          paragraphs: [
            'Read whatever is currently stored at EEPROM address 0. If it is still the erased value (255), this is the first boot ever — pick and save any other value there. Either way, print exactly the value now sitting at that address.',
            'Once this passes, press the workbench\'s own Reset button and check your work again — without changing a single line, it should still pass, because the value is genuinely sitting in persistent storage, not a variable that reset just wiped.',
          ],
          starterCode: `#include <EEPROM.h>

const int ADDRESS = 0;

void setup() {
  Serial.begin(9600);
  byte stored = EEPROM.read(ADDRESS);

  // If this is the erased marker, this is the first boot: pick any
  // other value (0-254) and save it, so next boot sees it instead.
  // if (stored == 255) {
  //   stored = 7;
  //   EEPROM.update(ADDRESS, stored);
  // }

  // Print exactly the value now sitting at ADDRESS, whichever branch ran.
  // Serial.print("Stored: ");
  // Serial.println(stored);
}

void loop() {}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'eeprom-round-trip', label: 'Print exactly the real byte now stored at EEPROM address 0', rule: 'eeprom-round-trip' },
            { id: 'eeprom-persists-value', label: 'Really store a non-erased value in EEPROM, not just print one', rule: 'eeprom-persists-value' },
          ],
          hints: [
            'EEPROM.read(ADDRESS) returns a byte 0-255. Compare it to 255 to detect "never written."',
            'EEPROM.update(ADDRESS, value) only writes if the stored byte actually differs from value — safer than write() for a value that might already be correct, since each cell only tolerates about 100,000 writes.',
            'Print stored after the if, not before — that way the printed number always matches whatever the address really holds by the time setup() finishes, on the first boot and every boot after.',
          ],
        },
      ],
    },
  ],
};
