/*
  esp32_sensor_pack.ino — MRPL Muster Station Kiosk IoT Sensor Pack
  Hardware: ESP32 DevKit V1 + MQ-136 (H2S Gas Sensor) + DHT11 (Temp/Humidity)
  
  Pins:
    - MQ-136 Analog Output  -> GPIO 34 (ADC1_CH6)
    - DHT-11 Data Pin       -> GPIO 4
    - Status LED            -> GPIO 2 (Built-in LED)

  Protocol: HTTP POST JSON to Express API /api/ambient
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ── Configuration ────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "MRPL_Kiosk_Net";
const char* WIFI_PASSWORD = "RefinerySafety2026";
const char* API_ENDPOINT  = "http://172.16.0.2:4000/api/ambient";
const char* KIOSK_ID      = "KIOSK-MUSTER-01";

#define MQ136_PIN 34
#define DHT_PIN   4
#define DHT_TYPE  DHT11
#define LED_PIN   2

DHT dht(DHT_PIN, DHT_TYPE);

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(MQ136_PIN, INPUT);

  dht.begin();
  Serial.println("[ESP32] Starting H2S Kiosk Telemetry Module...");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
  }
  digitalWrite(LED_PIN, HIGH);
  Serial.println("\n[ESP32] WiFi Connected! IP: " + WiFi.localIP().toString());
}

float readMQ136PPM() {
  int rawADC = analogRead(MQ136_PIN);
  float voltage = rawADC * (3.3 / 4095.0);
  // Calibration equation: RS/R0 mapped to H2S ppm (0.1 - 100 ppm curve)
  float ppm = max(0.0f, (voltage - 0.4f) * 12.5f);
  return ppm;
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    float h2s_ppm = readMQ136PPM();
    float temp_c  = dht.readTemperature();
    float hum_pct = dht.readHumidity();

    if (isnan(temp_c)) temp_c = 28.5;
    if (isnan(hum_pct)) hum_pct = 65.0;

    StaticJsonDocument<200> doc;
    doc["kiosk_location"]   = KIOSK_ID;
    doc["ambient_h2s_ppm"] = round(h2s_ppm * 100.0) / 100.0;
    doc["temperature_c"]    = round(temp_c * 10.0) / 10.0;
    doc["humidity_percent"] = round(hum_pct * 10.0) / 10.0;

    String jsonPayload;
    serializeJson(doc, jsonPayload);

    HTTPClient http;
    http.begin(API_ENDPOINT);
    http.addHeader("Content-Type", "application/json");

    int httpCode = http.POST(jsonPayload);
    if (httpCode > 0) {
      Serial.printf("[ESP32] Telemetry sent -> HTTP %d\n", httpCode);
    } else {
      Serial.printf("[ESP32] HTTP POST failed, error: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  }
  delay(3000); // 3-second telemetry cycle
}
