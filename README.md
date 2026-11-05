# Konsultacje komunikacji Gminy Sobótka - MVP

Pliki:
- index.html - interfejs
- app.js - logika aplikacji
- style.css - wygląd
- sobotka_transport.json - projekt komunikacji
- consultation_schema.json - model odpowiedzi mieszkańca

## Uruchomienie lokalne
Ze względu na fetch() przeglądarka powinna otworzyć aplikację przez prosty serwer HTTP, np. z katalogu projektu:

python -m http.server 8000

Następnie otwórz http://localhost:8000

## MVP
Opinie są zapisywane w localStorage. To celowe: wersja demonstracyjna nie wysyła danych mieszkańców. Przed publikacją należy podłączyć backend/API, mechanizm zgód i politykę prywatności.
