const uartSetup = `#include <stdio.h>
#include "pico/stdlib.h"
#include "hardware/uart.h"
#include "hardware/sync.h"

#define LED_PIN 25
#define BUTTON_PIN 14

static void serial_init(void) {
    uart_init(uart0, 115200);
    gpio_set_function(0, GPIO_FUNC_UART);
    gpio_set_function(1, GPIO_FUNC_UART);
}
`;

export const examples = [
  {
    id: 'blink',
    name: 'Blink + serial',
    description: 'Onboard LED on GP25. UART0 output on GP0.',
    source: `${uartSetup}
int main(void) {
    serial_init();
    gpio_init(LED_PIN);
    gpio_set_dir(LED_PIN, GPIO_OUT);
    uart_puts(uart0, "Pico is ready!\\r\\n");

    while (true) {
        gpio_put(LED_PIN, 1);
        uart_puts(uart0, "LED on\\r\\n");
        sleep_ms(500);
        gpio_put(LED_PIN, 0);
        uart_puts(uart0, "LED off\\r\\n");
        sleep_ms(500);
    }
}
`,
  },
  {
    id: 'button',
    name: 'Button input',
    description: 'External button between GP14 and GND, with an internal pull-up.',
    source: `${uartSetup}
int main(void) {
    serial_init();
    gpio_init(LED_PIN);
    gpio_set_dir(LED_PIN, GPIO_OUT);
    gpio_init(BUTTON_PIN);
    gpio_set_dir(BUTTON_PIN, GPIO_IN);
    gpio_pull_up(BUTTON_PIN);
    uart_puts(uart0, "Press the GP14 button.\\r\\n");

    bool was_pressed = false;
    while (true) {
        bool pressed = !gpio_get(BUTTON_PIN);
        gpio_put(LED_PIN, pressed);
        if (pressed != was_pressed) {
            uart_puts(uart0, pressed ? "Button pressed\\r\\n"
                                     : "Button released\\r\\n");
            was_pressed = pressed;
        }
        sleep_ms(10);
    }
}
`,
  },
  {
    id: 'timer',
    name: 'Timer interrupt',
    description: 'A repeating hardware timer toggles the onboard LED.',
    source: `${uartSetup}
static bool led_on = false;

static bool tick(struct repeating_timer *timer) {
    (void)timer;
    led_on = !led_on;
    gpio_put(LED_PIN, led_on);
    return true;
}

int main(void) {
    serial_init();
    gpio_init(LED_PIN);
    gpio_set_dir(LED_PIN, GPIO_OUT);
    struct repeating_timer timer;
    add_repeating_timer_ms(500, tick, NULL, &timer);
    uart_puts(uart0, "Hardware timer started.\\r\\n");

    while (true) {
        __wfi();
    }
}
`,
  },
] as const;

export const DEFAULT_SOURCE = examples[0].source;

/* ─── Arduino Uno examples ───────────────────────────────────────
   Separate from Pico examples; profile: 'arduino-uno', file: sketch.ino
   All sketches use the Arduino setup()/loop() API and Serial for UART0.
   ─────────────────────────────────────────────────────────────── */
export const ARDUINO_EXAMPLES = [
  {
    id: 'arduino-blink',
    name: 'Blink',
    description: 'Blink the onboard LED on pin 13 (PB5) via Serial output.',
    source: `// Blink — toggles the onboard LED on D13 every 500 ms.
// UART0 output visible in the Serial console (9600 baud).
void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
  Serial.println("Blink started");
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("LED on");
  delay(500);
  digitalWrite(13, LOW);
  Serial.println("LED off");
  delay(500);
}
`,
  },
  {
    id: 'arduino-button',
    name: 'Button',
    description: 'Button on D2 with INPUT_PULLUP; LED mirrors state, Serial reports changes.',
    source: `// Button — reads D2 with internal pull-up.
// Press the virtual button in the board panel to drive D2 LOW.
const int LED = 13;
const int BTN = 2;

bool lastState = HIGH;

void setup() {
  pinMode(LED, OUTPUT);
  pinMode(BTN, INPUT_PULLUP);
  Serial.begin(9600);
  Serial.println("Hold the button on pin 2.");
}

void loop() {
  bool state = digitalRead(BTN);
  if (state != lastState) {
    lastState = state;
    bool pressed = (state == LOW);
    digitalWrite(LED, pressed ? HIGH : LOW);
    Serial.println(pressed ? "Button pressed" : "Button released");
  }
  delay(10);
}
`,
  },
  {
    id: 'arduino-timer',
    name: 'Timer',
    description: 'Non-blocking LED blink with millis() — no delay() blocking the loop.',
    source: `// Timer — non-blocking blink using millis().
// Demonstrates how to keep loop() free for other work.
const int LED = 13;
const unsigned long INTERVAL = 500;

unsigned long prevMs  = 0;
bool          ledState = false;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Non-blocking timer ready.");
}

void loop() {
  unsigned long now = millis();
  if (now - prevMs >= INTERVAL) {
    prevMs   = now;
    ledState = !ledState;
    digitalWrite(LED, ledState ? HIGH : LOW);
    Serial.println(ledState ? "LED on" : "LED off");
  }
}
`,
  },
] as const;

export const ARDUINO_DEFAULT_SOURCE = ARDUINO_EXAMPLES[0].source;
