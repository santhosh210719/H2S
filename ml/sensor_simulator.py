"""
ml/sensor_simulator.py — IoT Sensor Pack Simulator (MQ-136 + DHT-11).

Streams live telemetry to POST http://localhost:4000/api/ambient every 3 seconds.
Simulates normal ambient fluctuations (H2S 0.0-0.8 ppm, Temp 27-32 °C, Humidity 60-70%)
and includes occasional minor drifts or spikes.
"""
from __future__ import annotations

import json
import random
import sys
import time
from urllib.request import Request, urlopen

API_URL = "http://localhost:4000/api/ambient"
KIOSK_ID = "KIOSK-MUSTER-01"


def send_reading(h2s: float, temp: float, humidity: float, worker_id: str | None = None) -> bool:
    payload = {
        "kiosk_location": KIOSK_ID,
        "ambient_h2s_ppm": round(h2s, 2),
        "temperature_c": round(temp, 1),
        "humidity_percent": round(humidity, 1),
        "worker_id": worker_id,
    }
    data = json.dumps(payload).encode("utf-8")
    req = Request(API_URL, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"[SensorSimulator] Error sending telemetry: {e}", file=sys.stderr)
        return False


def run_simulator(interval: float = 3.0, iterations: int | None = None):
    print(f"[SensorSimulator] Telemetry loop started -> {API_URL} (interval: {interval}s)")
    count = 0
    base_h2s = 0.3
    base_temp = 29.5
    base_hum = 64.0

    while iterations is None or count < iterations:
        # Random walk
        base_h2s = max(0.05, min(1.8, base_h2s + random.uniform(-0.1, 0.12)))
        temp = base_temp + random.uniform(-0.8, 0.8)
        hum = base_hum + random.uniform(-1.5, 1.5)

        # 5% chance of a localized spike (e.g. ambient process leak)
        if random.random() < 0.05:
            h2s_val = round(random.uniform(4.5, 12.0), 2)
            print(f"[SensorSimulator] ⚠️ Simulated ambient H2S spike: {h2s_val} ppm")
        else:
            h2s_val = round(base_h2s, 2)

        ok = send_reading(h2s_val, temp, hum)
        count += 1
        if ok:
            print(f"[SensorSimulator] Sent #{count}: H2S={h2s_val} ppm | Temp={temp:.1f}°C | Hum={hum:.1f}%")
        time.sleep(interval)


if __name__ == "__main__":
    interval = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
    run_simulator(interval=interval)
