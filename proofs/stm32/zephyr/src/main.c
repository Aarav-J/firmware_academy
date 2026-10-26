#include <zephyr/drivers/gpio.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/printk.h>

static const struct gpio_dt_spec blink_led = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
static const struct gpio_dt_spec button_led = GPIO_DT_SPEC_GET(DT_ALIAS(led1), gpios);
static const struct gpio_dt_spec user_button = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);

K_THREAD_STACK_DEFINE(blink_stack, 1024);
static struct k_thread blink_thread;

/* Observable in GDB without relying on a terminal or host wall-clock time. */
volatile uint32_t proof_blink_edges;
volatile uint32_t proof_button_events;
volatile int proof_button_pressed;

static void blink(void *unused1, void *unused2, void *unused3)
{
	ARG_UNUSED(unused1);
	ARG_UNUSED(unused2);
	ARG_UNUSED(unused3);

	for (;;) {
		k_msleep(500);
		int error = gpio_pin_toggle_dt(&blink_led);

		if (error != 0) {
			printk("Zephyr STM32 proof: blink GPIO error %d\n", error);
			return;
		}
		proof_blink_edges++;
		printk("LED %s\n", (proof_blink_edges & 1U) ? "on" : "off");
	}
}

int main(void)
{
	if (!gpio_is_ready_dt(&blink_led) || !gpio_is_ready_dt(&button_led) ||
	    !gpio_is_ready_dt(&user_button)) {
		printk("Zephyr STM32 proof: GPIO device not ready\n");
		return -ENODEV;
	}

	int error = gpio_pin_configure_dt(&blink_led, GPIO_OUTPUT_INACTIVE);

	if (error == 0) {
		error = gpio_pin_configure_dt(&button_led, GPIO_OUTPUT_INACTIVE);
	}
	if (error == 0) {
		error = gpio_pin_configure_dt(&user_button, GPIO_INPUT | GPIO_PULL_DOWN);
	}
	if (error != 0) {
		printk("Zephyr STM32 proof: GPIO configuration error %d\n", error);
		return error;
	}

	printk("Zephyr STM32 proof ready\n");
	printk("HSI=16000000 Hz; UART2=115200; blink=500 ms; button=PA0\n");
	k_tid_t tid = k_thread_create(&blink_thread, blink_stack,
				    K_THREAD_STACK_SIZEOF(blink_stack), blink,
				    NULL, NULL, NULL, 5, 0, K_NO_WAIT);
	k_thread_name_set(tid, "proof_blink");

	int previous = -1;

	for (;;) {
		int pressed = gpio_pin_get_dt(&user_button);

		if (pressed < 0) {
			printk("Zephyr STM32 proof: button GPIO error %d\n", pressed);
			return pressed;
		}
		if (pressed != previous) {
			error = gpio_pin_set_dt(&button_led, pressed);
			if (error != 0) {
				printk("Zephyr STM32 proof: button LED error %d\n", error);
				return error;
			}
			proof_button_pressed = pressed;
			/* Initial state is reported, but is not counted as an edge. */
			if (previous >= 0) {
				proof_button_events++;
			}
			printk("Button %s\n", pressed ? "pressed" : "released");
			previous = pressed;
		}
		k_msleep(10);
	}
}
