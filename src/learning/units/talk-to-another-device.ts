import type { CourseUnit } from '../types';

export const talkToAnotherDeviceUnit: CourseUnit = {
  id: 'talk-to-another-device',
  title: 'Talk to another device',
  description: 'Exchange structured information over a real wire protocol, and handle communication failures honestly.',
  lessons: [
    {
      id: 'what-serial-is-doing',
      title: 'What Serial is doing',
      description: 'A UART frame and a small command interface, built on real incoming bytes.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Serial is a wire protocol, not magic',
          paragraphs: [
            'Serial.print() has only ever sent bytes out. The same USART peripheral can also receive: Serial.available() reports whether an unread byte has arrived, and Serial.read() returns and consumes the oldest one.',
            'Every byte travels as a UART frame: the line idles HIGH, drops LOW for one start bit, sends the data bits least-significant-bit first, then returns HIGH for one stop bit. Both sides must already agree on the baud rate — there is no separate clock wire carrying timing information.',
            'A tiny command interface reads one incoming byte and reacts to it: if (Serial.available()) { char command = Serial.read(); ... }. This is the same idea as the button unit\'s edge detection, applied to a byte instead of a pin level.',
          ],
          takeaway: 'Serial.read() consumes one received byte at a time; both sides must agree on baud rate in advance.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Follow one byte\'s frame',
          concept: 'uart-protocol',
          paragraphs: [
            'Step through the start bit, each data bit, and the stop bit for one transmitted byte.',
          ],
          instruction: 'Advance bit by bit and notice the data bits appear least-significant-bit first.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'What happens with no available byte?',
          prompt: 'A sketch calls char command = Serial.read(); without first checking Serial.available(). No byte has actually arrived yet. What does Serial.read() return?',
          options: [
            { id: 'blocks', label: 'It blocks, waiting indefinitely for a byte to arrive.' },
            { id: 'returns-negative-one', label: 'It returns -1 immediately, since there is nothing to read.' },
            { id: 'returns-zero', label: 'It returns 0, the same as receiving a null byte.' },
          ],
          answerId: 'returns-negative-one',
          explanation: 'Serial.read() never blocks. With nothing available, it immediately returns -1 — which is exactly why checking Serial.available() first matters.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Add a small command interface',
          paragraphs: [
            'Read incoming Serial bytes and control D13 with them: receiving the byte \'1\' should turn D13 HIGH, receiving \'0\' should turn it LOW. Invalid or unrecognized bytes should be ignored.',
            'Use the two command buttons below the board to send real bytes into the simulated chip\'s receiver.',
          ],
          starterCode: `void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
}

void loop() {
  if (Serial.available()) {
    char command = Serial.read();
    // '1' -> D13 HIGH, '0' -> D13 LOW, anything else -> ignore.
  }
}
`,
          serialCommands: [{ label: "Send '1' (LED on)", char: '1' }, { label: "Send '0' (LED off)", char: '0' }],
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'uart-command-handled', label: 'Set D13 correctly from a real received command byte', rule: 'uart-command-handled' },
          ],
          hints: [
            "if (command == '1') digitalWrite(13, HIGH); else if (command == '0') digitalWrite(13, LOW);",
            'Checking Serial.available() first avoids acting on a read that returned -1.',
            'Send one command, let it settle for a moment, then check your work.',
          ],
        },
      ],
    },
    {
      id: 'address-a-peripheral',
      title: 'Address a peripheral',
      description: 'Read an identification register from a real I2C transaction, and handle an unsupported address honestly.',
      durationMinutes: 16,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'A bus with many possible devices',
          paragraphs: [
            'I2C (the Wire library in Arduino) lets many devices share two wires — SDA for data, SCL for a shared clock — each identified by its own 7-bit address. A transaction starts with the controller (your Uno) sending a START condition, then the target address plus a read/write bit.',
            'Only a device that recognizes its own address responds with an acknowledgment (ACK); every other device stays silent, which the controller reads as a NACK. Wire.endTransmission() returns 0 on success and a nonzero error code when no device acknowledged — a real, checkable signal that communication failed.',
            'Reading a specific piece of data from a device usually takes two steps: first write the register address you want (Wire.beginTransmission, Wire.write, Wire.endTransmission), then request the actual data (Wire.requestFrom, Wire.read).',
          ],
          takeaway: 'An I2C device only responds if the address matches; endTransmission() tells you honestly whether it did.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Step through a full transaction',
          concept: 'i2c-transaction',
          paragraphs: [
            'Follow the real sequence: start, address, acknowledgment, register selection, repeated start, the returned byte, and stop.',
          ],
          instruction: 'Step all the way through once, then imagine the address step failing instead — everything after it would never happen.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'What does a wrong address produce?',
          prompt: 'Your sketch calls Wire.beginTransmission(0x12) for a device that does not exist at that address, then Wire.endTransmission(). What is the most reliable way to detect this went wrong?',
          options: [
            { id: 'check-return', label: "Check endTransmission()'s nonzero return value." },
            { id: 'assume-success', label: 'Assume it worked, since no error is thrown automatically.' },
            { id: 'check-timing', label: 'Measure how long the call took to decide whether it succeeded.' },
          ],
          answerId: 'check-return',
          explanation: 'endTransmission() returns a specific nonzero code when the addressed device never acknowledged. That return value is the reliable signal — nothing fails loudly on its own.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Read a device, then handle a failure',
          paragraphs: [
            'This workbench simulates one real I2C peripheral at address 0x50, with an identification register at register 0x00 containing the fixed value 0x5A.',
            'Read that identification register and print it, clearly labeled, over Serial. Then attempt to address an unsupported device (any other 7-bit address, for example 0x12) and print an explicit error when it fails — without losing or overwriting the identification value you already printed.',
          ],
          starterCode: `#include <Wire.h>

void setup() {
  Serial.begin(9600);
  Wire.begin();

  // Read register 0x00 from the device at address 0x50 and print it,
  // for example: Serial.print("ID:"); Serial.println(value, HEX);

  // Then attempt address 0x12, check endTransmission()'s return value,
  // and print an explicit error if it is nonzero — without erasing
  // the identification value printed above.
}

void loop() {}
`,
          goals: [
            { id: 'build', label: 'Build the sketch successfully', rule: 'build' },
            { id: 'i2c-identifies-device', label: 'Read the real identification register (0x5A) from the supported device', rule: 'i2c-identifies-device' },
            { id: 'i2c-handles-failure', label: 'Report the unsupported-address failure explicitly, while still showing the last valid reading', rule: 'i2c-handles-failure' },
          ],
          hints: [
            'Wire.beginTransmission(0x50); Wire.write(0x00); Wire.endTransmission(); Wire.requestFrom(0x50, 1); then Wire.read() returns the identification byte.',
            'Wire.beginTransmission(0x12); uint8_t error = Wire.endTransmission(); if (error != 0) Serial.println("Error: device not found");',
            'Print the identification value before attempting the failing address, so both remain in the Serial output.',
          ],
        },
      ],
    },
  ],
};
