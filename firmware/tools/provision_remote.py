#!/usr/bin/env python3
"""Provision the remote-admin token over the directly attached ESP32 USB UART."""

import argparse
import getpass
import re
import sys
import time

import serial


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, help="USB serial port confirmed by the hardware session")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--status", action="store_true", help="Read USB-only remote transport and heap diagnostics")
    action.add_argument("--clear", action="store_true", help="Disable remote admin on the device")
    args = parser.parse_args()

    if not sys.stdin.isatty():
        parser.error("Run this command in an interactive terminal.")
    if args.status:
        command = b"desk-remote-status\n"
        expected = None
    elif args.clear:
        command = b"desk-remote-clear\n"
        expected = b"Remote admin disabled."
    else:
        token = getpass.getpass("Device token (input hidden): ")
        if not re.fullmatch(r"[0-9a-f]{64}", token):
            parser.error("Enter a device token consisting of 64 lowercase hexadecimal characters.")
        command = b"desk-remote-set " + token.encode("ascii") + b"\n"
        del token
        expected = b"Remote admin credential saved."

    try:
        # Deassert boot/reset controls before opening the CP210x/CH340-style UART.
        with serial.Serial(baudrate=115200, timeout=0.25, write_timeout=2, exclusive=True) as port:
            port.dtr = False
            port.rts = False
            port.port = args.port
            port.open()
            time.sleep(2)
            port.reset_input_buffer()
            port.write(command)
            port.flush()
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                line = port.read_until(size=256).strip()
                if line == expected or (args.status and re.fullmatch(
                    rb"Remote enabled=[01] transport_ok=[01] http=-?[0-9]+ "
                    rb"heap_before=[0-9]+ largest_before=[0-9]+ heap_with_tls=[0-9]+ worker_stack_free=[0-9]+",
                    line,
                )):
                    print(line.decode("ascii"))
                    return 0
                if line == b"Remote admin provisioning failed.":
                    print("The device could not save the provisioning change.", file=sys.stderr)
                    return 1
    except serial.SerialException:
        print("USB serial could not be opened or used.", file=sys.stderr)
        return 1
    print("No provisioning acknowledgement was received.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
