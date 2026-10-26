#include <stdint.h>

#define REG32(address) (*(volatile uint32_t *)(address))
#define RCC_AHB1ENR REG32(0x40023830u)
#define RCC_APB1ENR REG32(0x40023840u)
#define GPIOA_MODER REG32(0x40020000u)
#define GPIOA_PUPDR REG32(0x4002000cu)
#define GPIOA_IDR REG32(0x40020010u)
#define GPIOA_AFRL REG32(0x40020020u)
#define GPIOD_MODER REG32(0x40020c00u)
#define GPIOD_BSRR REG32(0x40020c18u)
#define USART2_SR REG32(0x40004400u)
#define USART2_DR REG32(0x40004404u)
#define USART2_BRR REG32(0x40004408u)
#define USART2_CR1 REG32(0x4000440cu)
#define SYST_CSR REG32(0xe000e010u)
#define SYST_RVR REG32(0xe000e014u)
#define SYST_CVR REG32(0xe000e018u)

extern uint32_t _stack_top, _data_load, _data_start, _data_end, _bss_start, _bss_end;
volatile uint32_t milliseconds;
volatile uint32_t led_transitions;
volatile uint32_t button_transitions;
volatile uint32_t button_pressed;

void Reset_Handler(void);
void SysTick_Handler(void);
void Default_Handler(void);
int main(void);

__attribute__((section(".isr_vector"), used))
void (*const vector_table[])(void) = {
    (void (*)(void))(&_stack_top), Reset_Handler,
    Default_Handler, Default_Handler, Default_Handler, Default_Handler,
    Default_Handler, 0, 0, 0, 0, Default_Handler,
    Default_Handler, 0, Default_Handler, SysTick_Handler
};

void Default_Handler(void) {
    while (1) { __asm volatile("wfi"); }
}

void SysTick_Handler(void) {
    milliseconds++;
}

void Reset_Handler(void) {
    uint32_t *source = &_data_load;
    for (uint32_t *destination = &_data_start; destination < &_data_end;) {
        *destination++ = *source++;
    }
    for (uint32_t *destination = &_bss_start; destination < &_bss_end;) {
        *destination++ = 0;
    }
    (void)main();
    Default_Handler();
}

static void uart_puts(const char *text) {
    while (*text) {
        while (!(USART2_SR & (1u << 7))) { }
        USART2_DR = (uint32_t)*text++;
    }
}

// A stable breakpoint location immediately before the actual MMIO write.
__attribute__((noinline)) void set_blink_led(uint32_t high) {
    GPIOD_BSRR = high ? (1u << 12) : (1u << 28);
    led_transitions++;
}

int main(void) {
    // Reset HSI clock is 16 MHz. No vendor SDK, HAL, libc, or PLL setup.
    RCC_AHB1ENR |= (1u << 0) | (1u << 3);
    RCC_APB1ENR |= (1u << 17);
    (void)RCC_AHB1ENR;
    GPIOA_MODER = (GPIOA_MODER & ~((3u << 0) | (3u << 4) | (3u << 6)))
                | (2u << 4) | (2u << 6);
    GPIOA_PUPDR = (GPIOA_PUPDR & ~3u) | 2u; // PA0 active-high with pull-down.
    GPIOA_AFRL = (GPIOA_AFRL & ~((15u << 8) | (15u << 12)))
               | (7u << 8) | (7u << 12);
    GPIOD_MODER = (GPIOD_MODER & ~((3u << 24) | (3u << 26)))
                | (1u << 24) | (1u << 26);
    USART2_BRR = 139u; // 16 MHz / 115200, oversampling by 16.
    USART2_CR1 = (1u << 13) | (1u << 3) | (1u << 2);
    SYST_RVR = 16000u - 1u;
    SYST_CVR = 0;
    SYST_CSR = 7u; // Processor clock, exception enabled, counter enabled.
    uart_puts("Bare-metal STM32 proof ready\r\n");

    uint32_t last_toggle = milliseconds;
    uint32_t high = 0;
    GPIOD_BSRR = (1u << 28) | (1u << 29);
    while (1) {
        uint32_t now = milliseconds;
        if ((uint32_t)(now - last_toggle) >= 500u) {
            last_toggle = now;
            high = !high;
            set_blink_led(high);
            uart_puts(high ? "LED on\r\n" : "LED off\r\n");
        }
        uint32_t pressed = GPIOA_IDR & 1u;
        if (pressed != button_pressed) {
            button_pressed = pressed;
            button_transitions++;
            GPIOD_BSRR = pressed ? (1u << 13) : (1u << 29);
            uart_puts(pressed ? "Button pressed\r\n" : "Button released\r\n");
        }
        __asm volatile("wfi");
    }
}
