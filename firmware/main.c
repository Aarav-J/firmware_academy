#include "pico/stdlib.h"
#include "hardware/uart.h"
int main(void) {
    stdio_init_all();
    gpio_init(25);
    gpio_set_dir(25, GPIO_OUT);
    for (;;) {
        gpio_put(25, 1);
        sleep_ms(500);
        gpio_put(25, 0);
        sleep_ms(500);
    }
}
