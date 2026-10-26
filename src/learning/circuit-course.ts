import type { CourseUnit } from './types';
import { CIRCUIT_SCENARIOS } from './circuit-model';

export const circuitUnit: CourseUnit = {
  id: 'connect-a-circuit',
  title: 'Connect a circuit',
  description:
    'Complete a current path, orient an LED, choose a current-limiting resistor, then connect an external light to a real running sketch.',
  lessons: [
    {
      id: 'complete-the-path',
      title: 'Complete the path',
      description: 'Give an external LED a complete path from an output back to the board’s ground.',
      durationMinutes: 12,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'A connection needs a return path',
          paragraphs: [
            'The built-in LED already has its connections on the Uno. An external LED needs you to make those connections. For this circuit, conventional current travels from a HIGH output, through a resistor and a forward-facing LED, and back to GND. A break anywhere in that loop stops the steady current.',
            'GND means ground: the board’s common voltage reference and the return connection for this circuit. A HIGH output is approximately 5 volts relative to that ground in our teaching model. Ground is not a special instruction in your C program, and a loose wire near a GND pin is not a connection.',
            'A 330-ohm resistor is already in the path. Keep it there: it limits the estimated current to a suitable value for this lesson. We will explain how to choose that value in the resistor lesson. Do not connect the output directly to GND or remove the resistor to make a shorter route.',
            'A solderless breadboard contains metal strips beneath the holes. At each number, holes a–e connect together and holes f–j form a separate group across the center trench. The marked power rails run along the edges. Select a hole to see its connected group; a component lead or jumper must be inserted into a hole to use that connection.',
          ],
          takeaway: 'An LED circuit needs an unbroken, current-limited path out from the output and back to the same board’s ground.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Trace the whole loop',
          concept: 'closed-circuit',
          paragraphs: [
            'Follow each connection from D8 through the resistor and LED to GND. If the return connection is missing, supplying a voltage at one end is not enough to sustain current through the LED.',
            'This is a conceptual model, not a running sketch or a measurement of a physical circuit. The circuit-only activities assume D8 is a 5 V source so you can work on wiring without compiling code. In the final lesson, an actual compiled sketch will control the emulated D8 pin.',
          ],
          instruction: 'Compare the open and closed path in the model. Trace both from D8 all the way to GND and identify the connection that lets the loop close.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'One connection is missing',
          prompt: 'D8 is HIGH. A wire joins D8 to a 330-ohm resistor, and the resistor is wired to the LED’s anode. The LED’s cathode has no wire to GND. What should you expect?',
          options: [
            { id: 'one-sided-power', label: 'The LED stays on because its anode is connected to a HIGH output.' },
            { id: 'open-path', label: 'No steady LED current flows because the path back to GND is open.' },
            { id: 'nearby-ground', label: 'The LED lights if its cathode is placed close enough to a GND pin.' },
          ],
          answerId: 'open-path',
          explanation: 'The output supplies a voltage relative to GND, but the open return path prevents steady current through the LED. Physical proximity is not an electrical connection on this canvas. A wire from the cathode to GND completes the intended path without bypassing the resistor.',
        },
        {
          id: 'activity',
          kind: 'circuit',
          title: 'Connect the return wire',
          paragraphs: [
            'The resistor and LED are already connected to D8, but the return path is open. Add the missing connection from the LED’s cathode to an Uno GND pin. Keep the supplied 330-ohm resistor in series: the same branch must pass through both the resistor and LED.',
            'Trace the inserted leads, jumper wires, and breadboard strips. Any free hole in the same five-hole group as the cathode can carry its return connection to GND. Check your circuit when you can trace D8 → resistor → LED → GND without a break or bypass.',
            'This activity checks the wiring and a simplified current estimate. There is no code editor, build, or running firmware to change here.',
          ],
          scenario: CIRCUIT_SCENARIOS['open-loop'],
          goals: [
            { id: 'complete-path', label: 'Complete the path from D8 through the LED to GND', rule: 'complete-path' },
            { id: 'led-forward', label: 'Keep the LED’s anode toward D8 and cathode toward GND', rule: 'led-forward' },
            { id: 'series-resistor', label: 'Keep a current-limiting resistor in the LED’s series path', rule: 'series-resistor' },
            { id: 'safe-current', label: 'Keep estimated current within the 2–10 mA teaching target', rule: 'safe-current' },
          ],
          hints: [
            'Start at D8 and follow the existing wires. Which LED terminal ends without a return connection?',
            'Select the LED to identify ANODE and CATHODE and see their hole locations. The five holes with the same number on one side of the trench share a connection.',
            'Connect a free hole in the cathode’s group to an Uno GND pin. Use Find a pin if the board labels are too small; it centers and enlarges the real pin location. Keep D8 connected through the resistor to ANODE.',
          ],
        },
      ],
    },
    {
      id: 'led-direction',
      title: 'Give the LED a direction',
      description: 'Distinguish a complete loop from a loop that lets an LED conduct forward.',
      durationMinutes: 14,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Two leads, two different jobs',
          paragraphs: [
            'LED means light-emitting diode. A diode is directional: in the intended operating direction, conventional current enters its anode and leaves its cathode. For our HIGH-output circuit, the anode faces the D8 side of the path and the cathode faces GND.',
            'An ordinary through-hole LED often has a longer anode lead and a flat edge on the cathode side. Cut leads and different packages can make those clues unreliable; use the component’s labeling or datasheet on real hardware. On this canvas, the terminals are explicitly named ANODE and CATHODE.',
            'A resistor is different. Its two ends have no polarity, so swapping them does not change its resistance. The resistor can sit before or after the LED in the same series path. What matters is that LED current cannot take a shortcut around it.',
            'A reversed LED is not repaired by asking for a higher output or by removing the resistor. Our model reports reverse orientation without simulating damage. Real LEDs have reverse-voltage limits; do not treat the lack of simulated damage as permission to reverse-power a real part.',
          ],
          takeaway: 'A closed path is necessary, but an LED also needs its anode toward the positive side and its cathode toward ground.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Follow anode to cathode',
          concept: 'led-polarity',
          paragraphs: [
            'Compare the LED’s direction with the intended current path. Wiring D8 to the cathode puts the LED backward even when every terminal belongs to a connected loop.',
            'Keep the resistor while you compare directions. Moving it to the other side of the LED, or swapping the resistor’s ends, does not change which LED terminal is the anode.',
          ],
          instruction: 'Compare the forward and reversed LED paths in the model. Identify ANODE and CATHODE, then follow the forward path from D8 to GND.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Does the resistor need a direction?',
          prompt: 'A forward-facing LED is connected in series with a resistor between HIGH D8 and GND. You move the resistor from the D8 side of the LED to the GND side, keeping one series path. What changes in our model?',
          options: [
            { id: 'same-current', label: 'Nothing about LED direction or estimated current; both parts still share the same series path.' },
            { id: 'unprotected-led', label: 'The LED loses current limiting because the resistor must come before it.' },
            { id: 'reversed-resistor', label: 'The resistor becomes backward and blocks the current.' },
          ],
          answerId: 'same-current',
          explanation: 'The same current passes through every part of one series path. The resistor limits that current on either side of the LED and has no polarity. The LED remains directional: its anode must still face the D8 side and its cathode the GND side.',
        },
        {
          id: 'activity',
          kind: 'circuit',
          title: 'Repair the reversed LED',
          paragraphs: [
            'This circuit has a complete path, but the LED faces backward: the resistor leads toward CATHODE and ANODE leads toward GND. Select the LED and swap its two inserted lead locations, or change the jumper connections, to repair the direction.',
            'Keep the 330-ohm resistor in series. You may put the resistor on either side of the LED and use either resistor terminal as the input. The final path must still run from D8, through a resistor and forward LED, to the Uno’s GND.',
            'Check the wiring, not just the LED drawing. This circuit-only activity uses a conceptual HIGH source and an estimated current; it does not compile or run a sketch.',
          ],
          scenario: CIRCUIT_SCENARIOS['reversed-led'],
          goals: [
            { id: 'complete-path', label: 'Keep an unbroken LED path between D8 and GND', rule: 'complete-path' },
            { id: 'led-forward', label: 'Reconnect ANODE toward D8 and CATHODE toward GND', rule: 'led-forward' },
            { id: 'series-resistor', label: 'Keep the resistor in series without a bypass', rule: 'series-resistor' },
            { id: 'safe-current', label: 'Keep estimated current within the 2–10 mA teaching target', rule: 'safe-current' },
          ],
          hints: [
            'A complete loop can still have a backward LED. Follow the wire leaving the resistor and read the LED terminal name.',
            'Select the LED and inspect the holes occupied by ANODE and CATHODE. Swap those two lead locations to reverse the LED while keeping the existing jumper wires.',
            'One valid arrangement is D8 → resistor → ANODE, then CATHODE → GND. Leads inserted into a shared five-hole strip connect automatically. The center trench separates the two groups at each number.',
          ],
        },
      ],
    },
    {
      id: 'choose-a-resistor',
      title: 'Choose a resistor',
      description: 'Use voltage drop and Ohm’s law to choose and explain a current-limiting resistance.',
      durationMinutes: 18,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Give the remaining voltage somewhere to drop',
          paragraphs: [
            'An LED is not a resistor, and a HIGH pin is not a constant-current supply. A series resistor limits current. In our simplified model, the source is 5 V and the forward LED drops a fixed 2 V, leaving 3 V across the resistor. Do not use the whole 5 V when calculating the resistor’s current.',
            'Ohm’s law for the resistor is I = V / R. Here I = (5 V − 2 V) / R. With resistance R in ohms, the result is in amperes; multiply by 1000 to get milliamperes. For this activity, I_mA = 3000 / R_ohms. For scale, 0.001 A is 1 mA.',
            'Use 2–10 mA, including the endpoints, as this activity’s teaching target. This is a supplied design target, not an Arduino chip specification or a universal LED rating. Increasing R lowers the estimated current; decreasing R raises it. An open circuit is not an acceptable way to reach a small current.',
            'Real source voltages and LED forward drops vary. Real designs also check the LED, resistor power rating, and microcontroller pin and total-current limits in their datasheets. Our fixed-drop estimate and safety checks do not simulate silicon damage, heat, or a complete analog circuit.',
          ],
          takeaway: 'Subtract the LED’s voltage drop, divide the remaining voltage by resistance, then convert amperes to milliamperes.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Change resistance, compare current',
          concept: 'resistor-current',
          paragraphs: [
            'Keep the same 5 V source and fixed 2 V LED drop while comparing resistor values. The resistor always has 3 V across it in this model, so the estimated current changes inversely with resistance.',
            'The current readout is a calculation, not a sensor measurement. It assumes a complete forward LED path with a series resistor. Neither an animation nor a reported estimate proves that real hardware can safely tolerate every value.',
          ],
          instruction: 'Compare the available resistor values in the model. Find which estimates fall within 2–10 mA and explain why doubling the resistance would halve the estimated current.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'Which voltage belongs in the formula?',
          prompt: 'A complete forward LED circuit uses a 5 V source, a fixed 2 V LED drop, and a series resistor R in ohms. Which expression gives the estimated current in milliamperes?',
          options: [
            { id: 'whole-supply', label: '(5 / R) × 1000, because the resistor always sees the full supply voltage.' },
            { id: 'remaining-voltage', label: '((5 − 2) / R) × 1000, because the resistor drops the voltage left after the LED.' },
            { id: 'led-voltage', label: '(2 / R) × 1000, because only the LED’s voltage drop matters.' },
          ],
          answerId: 'remaining-voltage',
          explanation: 'The voltage drops along this series path add to the 5 V supply. With 2 V assigned to the forward LED, 3 V remains across R. Dividing that 3 V by ohms gives amperes; multiplying by 1000 converts the result to milliamperes.',
        },
        {
          id: 'activity',
          kind: 'circuit',
          title: 'Choose and calculate',
          paragraphs: [
            'The forward LED path is already wired, but its starting 100-ohm resistor gives an estimated 30 mA, above our 2–10 mA teaching target. Select a different resistance that meets the target while keeping a complete, forward, current-limited path.',
            'Calculate the current for the resistance you selected using I_mA = ((5 − 2) / R_ohms) × 1000. Enter your estimated current in the mA answer field; enter the number, not a code expression. Use a sensible decimal approximation if the division does not come out evenly.',
            'Check both the circuit and your calculation. Changing the selected resistance changes the estimate you need to enter. The number is a fixed-drop teaching estimate, not current measured from the emulated Uno.',
          ],
          scenario: CIRCUIT_SCENARIOS['choose-resistor'],
          goals: [
            { id: 'complete-path', label: 'Maintain a complete path from D8 through the LED to GND', rule: 'complete-path' },
            { id: 'led-forward', label: 'Keep the LED forward-facing', rule: 'led-forward' },
            { id: 'series-resistor', label: 'Keep the selected resistor in series with the LED', rule: 'series-resistor' },
            { id: 'safe-current', label: 'Choose a resistance giving an estimated 2–10 mA', rule: 'safe-current' },
            { id: 'current-calculation', label: 'Enter the estimated mA for your selected resistance', rule: 'current-calculation' },
          ],
          hints: [
            'The starting current is too high. Increase the resistance rather than breaking the path or reversing the LED.',
            'Subtract the LED’s fixed 2 V drop from the 5 V supply. Divide the remaining 3 V by your selected resistance in ohms, then multiply by 1000.',
            'Use 3000 divided by the selected ohms to get mA. A value from 2 through 10 meets the teaching target; enter that calculated number and update it if you change the resistor again.',
          ],
        },
      ],
    },
    {
      id: 'external-led',
      title: 'Take the blink outside',
      description: 'Wire an external LED to D8 and prove its 250 ms HIGH, 750 ms LOW rhythm with compiled firmware.',
      durationMinutes: 20,
      steps: [
        {
          id: 'introduction',
          kind: 'read',
          title: 'Two jobs: a circuit and a program',
          paragraphs: [
            'The first three activities assumed a HIGH source while you worked on the connections. Now the Arduino workbench will compile and run your sketch. The external LED connects to D8, not D13: LED_BUILTIN still names the built-in LED and will not select this new output.',
            'Build one series path between D8 and the board’s GND using the supplied resistor and LED. Either D8 → resistor → LED → GND or D8 → LED → resistor → GND is valid. Enter the LED at ANODE and leave at CATHODE. Insert leads into breadboard holes and use jumper wires between their connected groups and the Uno.',
            'Your sketch has two responsibilities. Configure pin 8 as OUTPUT once in setup(). In loop(), drive that same pin HIGH for 250 milliseconds, then LOW for 750 milliseconds, and repeat. The whole period is 1000 milliseconds: the output spends one quarter of each cycle HIGH.',
            'The workbench checks actual emulated D8 logic levels and their simulated durations, along with your wiring. It does not measure LED current. Any current value shown is a separate estimate using the 5 V source and fixed 2 V LED-drop model; the visual LED is not an analog brightness or damage simulation.',
          ],
          takeaway: 'Correct wiring and correct D8 firmware are separate requirements; a successful build alone proves neither one.',
        },
        {
          id: 'explore',
          kind: 'explore',
          title: 'Connect the output to the load',
          concept: 'external-output',
          paragraphs: [
            'A pin’s logic state and an LED’s behavior are not the same observation. D8 can switch HIGH and LOW even if the external LED is disconnected or reversed. Conversely, a correctly wired path cannot create the requested timing by itself.',
            'With a complete forward path, the HIGH part of this pattern provides the modeled voltage for LED current. LOW brings D8 near the same reference as GND, so this LED path has no forward-driving voltage. These explanations use a simplified electrical model; the exercise’s timing evidence comes from the running firmware.',
          ],
          instruction: 'Follow D8 through the external resistor and LED back to the common GND. Compare the HIGH and LOW portions of the model and separate what the wiring determines from what the sketch must determine.',
        },
        {
          id: 'predict',
          kind: 'predict',
          title: 'A correct waveform, a dark LED',
          prompt: 'The run shows D8 HIGH for 250 ms and LOW for 750 ms repeatedly, but the external LED’s cathode has no return connection. Which conclusion is justified?',
          options: [
            { id: 'all-correct', label: 'The whole exercise is correct because D8 has the requested timing.' },
            { id: 'wiring-needed', label: 'The D8 timing is correct, but the LED path is open and the wiring still needs repair.' },
            { id: 'longer-high', label: 'The open path can be fixed in software by leaving D8 HIGH longer.' },
          ],
          answerId: 'wiring-needed',
          explanation: 'The measured D8 transitions establish the firmware timing, not current through an external circuit. The cathode still needs a wired return to the same board’s GND, with a forward LED and a series resistor in the path. Longer delays cannot repair a missing connection.',
        },
        {
          id: 'exercise',
          kind: 'exercise',
          title: 'Wire and run a short-on blink',
          paragraphs: [
            'Wire the supplied 330-ohm resistor and external LED into one complete series path from D8 to GND. The parts start seated in separate breadboard groups, without jumper wires. Put the resistor before or after the LED, keep ANODE toward D8 and CATHODE toward GND, and do not bypass either part or short D8 to GND.',
            'Write the sketch in the empty setup() and loop() below. Use pinMode(pin, mode) to configure pin 8 as OUTPUT in setup. Use digitalWrite(pin, value) and delay(milliseconds) in loop to produce a repeating 250 ms HIGH, then 750 ms LOW signal on D8. Use the numeric pin 8 or your own named constant for it, not LED_BUILTIN.',
            'Use Build & run to compile and run the real Arduino sketch. Let it run through several complete cycles so the checks can observe the repeated HIGH and LOW durations. Repair wiring and firmware independently if only one set of checks passes.',
            'The goals require a successful build, a valid forward current-limited circuit, and the measured D8 timing. The current estimate remains a separate teaching calculation, not a measurement of current or LED brightness.',
          ],
          starterCode: `void setup() {
  // Configure the external LED's pin as an output.
}

void loop() {
  // Give the external output its repeating short-on, long-off rhythm.
}
`,
          hardware: CIRCUIT_SCENARIOS['external-led'],
          signal: { pin: 8, highMs: 250, lowMs: 750 },
          goals: [
            { id: 'build', label: 'Build the Arduino sketch successfully', rule: 'build' },
            { id: 'circuit-wiring', label: 'Wire a forward LED and series resistor between D8 and GND', rule: 'circuit-wiring' },
            { id: 'timed-blink', label: 'Measure repeated D8 HIGH for 250 ms and LOW for 750 ms', rule: 'timed-blink' },
          ],
          hints: [
            'Treat the circuit and sketch as two separate tasks. Trace a forward, current-limited path from D8 to GND, then make sure your program controls that same pin rather than the built-in LED.',
            'Configure pin 8 once in setup. In loop, each digitalWrite changes a level immediately; a following delay holds that level before the next write.',
            'One valid circuit is D8 → resistor → ANODE, then CATHODE → GND. In the repeating function, pair HIGH with a 250 ms wait and LOW with a 750 ms wait on pin 8, in that order; run long enough to observe several cycles.',
          ],
        },
      ],
    },
  ],
};
