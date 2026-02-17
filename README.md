# Control de asistencia docente (versión Python)

Esta versión está hecha con **Python (librería estándar) + SQLite**.

## Qué incluye
- Personalización completa: nombre institucional, subtítulo, colores y logo (URL).
- Registro de docentes con código único por cada profesor.
- Visualización de QR/código de barras representados de forma local en la interfaz.
- Registro de ENTRADA/SALIDA con fecha y hora exacta desde backend.
- Persistencia real en base de datos `attendance.db`.

## Ejecutar
```bash
python app.py
```

Abrir en el navegador:
- `http://localhost:5000`

## Estructura
- `app.py`: backend HTTP y APIs.
- `templates/index.html`: interfaz principal.
- `static/app.js`: lógica del cliente conectada al backend.
- `static/styles.css`: estilos visuales.
- `attendance.db`: base de datos SQLite (se crea automáticamente).
