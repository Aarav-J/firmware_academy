set pagination off
set confirm off
set remotetimeout 10
break set_blink_led
continue
printf "BREAKPOINT: set_blink_led\n"
info registers r0 r1 r2 r3 sp lr pc xpsr
x/1wx 0x40023830
x/1wx 0x40020c00
x/1wx 0x40020c14
set $pc_before = $pc
set $odr_before = *(unsigned int *)0x40020c14
disassemble /r set_blink_led
stepi 4
set $odr_after = *(unsigned int *)0x40020c14
printf "ODR_BEFORE=0x%x ODR_AFTER=0x%x PC_BEFORE=0x%x PC_AFTER=0x%x\n", $odr_before, $odr_after, $pc_before, $pc
if $pc == $pc_before
    echo FAIL: instruction stepping did not advance PC\n
    quit 1
end
if ($odr_before & 0x1000) != 0
    echo FAIL: LED must start low before first GPIO write\n
    quit 1
end
if ($odr_after & 0x1000) == 0
    echo FAIL: stepping GPIO write did not set LED output\n
    quit 1
end
echo REGISTER_STEP_PROOF_PASS\n
monitor pause
detach
