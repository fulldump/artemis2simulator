# Artemis2 simulator

Coleccion de implementaciones del simulador de la mision Artemis II, generadas por distintas IAs para comparar enfoques visuales, tecnicos y de uso.

## Prompt original

El desafio base esta en `PROMPT.md` y pide, en resumen:

```text
Acaba de comenzar la mision artemis 2, que envia una capsula tripulada alrededor de la luna, llevan menos de 24h de viaje. La travesia completa dura unos 10 dias desde su salida hasta su regreso.
1: busca datos de telemetria en tiempo real (probablemente algun webservice publico de la nasa o similar)
2: crea una visualizacion en javascript y html que:
2.1) tiene que estar a escala real
2.2) Dibuje la trayectoria completa de la capsula
2.3) Muestre el recorrido actual con una linea mas gruesa, con otro color, o de alguna otra forma
2.4) Indique claramente el punto donde se encuentra actualmente
```

## Implementaciones disponibles

- `claude-antigravity`: version mas completa, con panel de telemetria, timeline y capas gravitatorias.
- `chatgpt_thinking-web`: visualizacion 2D tecnica con enfoque fuerte en escala y fases de mision.
- `codex_xhigh-opencode`: lectura de telemetria OEM/AROW, timeline y estado de mision.
- `gemini-antigravity`: interfaz tipo panel con animaciones y datos de progreso.
- `gemini_fast-web`: version ligera y rapida para revisar la trayectoria principal.
- `grok_expert-web`: visual neon en canvas con control manual de progreso.

La landing comparativa de este repo esta en `index.html`.

## Enlaces oficiales

- Repo oficial: https://github.com/fulldump/artemis2simulator
- Sitio desplegado: https://artemis2simulator.holacloud.app

## Como contribuir con tu IA favorita

Quieres sumar una nueva version con la IA que prefieras (ChatGPT, Claude, Gemini, Grok, Copilot, Mistral, etc.)? Bienvenido.

1. Crea una carpeta nueva con un nombre claro, por ejemplo `nombreia-enfoque`.
2. Implementa tu simulador dentro de esa carpeta (`index.html` y assets necesarios).
3. Mantiene el espiritu del prompt: escala real, trayectoria completa, recorrido actual y posicion actual.
4. Agrega una descripcion corta de tu implementacion en la landing (`index.html` de la raiz).
5. Abre un PR con capturas o notas de lo que hace distinta tu version.

Cada contribucion ayuda a comparar como diferentes IAs resuelven el mismo problema de simulacion espacial.
