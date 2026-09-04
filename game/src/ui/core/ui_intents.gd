class_name UIIntents
extends Object
## Bus de señales de INTENCIÓN de la interfaz.
##
## Regla dura del ámbito `ui-ux` (GDD §10, `docs/03-equipo-agentes.md`): la UI
## solo lee el estado del juego y jamás lo muta directamente. Cuando una
## pantalla necesita que algo ocurra en el juego (empezar partida, confirmar
## planta/zona, pausar, ejecutar un comando de consola...) no toca `GameState`
## ni ningún nodo de `gameplay/` — emite aquí una señal de intención y espera
## a que la capa correspondiente (todavía por conectar; ver informe del
## agente `ui-ux`) decida si la cumple y cómo.
##
## No es un autoload: añadir uno requiere tocar `project.godot`, que no es de
## este agente. En su lugar es un singleton "manual" — patrón habitual en
## Godot 4 para no depender de la sección `[autoload]` de nadie más. Todas las
## pantallas deben obtener la instancia con `UIIntents.get_singleton()`, nunca
## instanciando la clase por su cuenta.

## Se ha pedido empezar una partida nueva con el arquetipo elegido.
signal run_start_requested(archetype: StringName)
## Se ha pedido continuar la partida guardada.
signal run_continue_requested()
## Confirmación de la pantalla de Estrategia: zona elegida, XP que se quiere
## gastar (p. ej. en reparar bajas) y qué compañeros se llevan a la planta.
## `squad_included` mapea arquetipo → bool (llevado / dejado atrás).
signal strategy_confirmed(zone: int, xp_to_spend: int, squad_included: Dictionary)
## Se ha pedido revivir a un compañero caído gastando experiencia.
signal squad_revive_requested(archetype: StringName)
## Cambio de pausa pedido por el jugador (tecla/botón de pausa).
signal pause_toggle_requested()
## Se ha pedido reiniciar la partida tras Game Over.
signal restart_requested()
## Se ha pedido volver al menú principal.
signal return_to_menu_requested()
## Se ha pedido salir de la aplicación.
signal quit_requested()
## Se ha reconocido la pantalla de Fin de planta (botón "Continuar"): quien
## controle el flujo de partida puede pasar a Estrategia para la planta
## siguiente.
signal floor_end_acknowledged()
## La consola se ha abierto o cerrado. Quien gobierne
## `GameState.action_status` puede querer reflejar `ActionStatus.CONSOLE`.
signal console_toggled(is_open: bool)

## --- Navegación entre pantallas propias de este agente -------------------
## Estas NO son intenciones de juego: son cambios de pantalla dentro de la UI
## (Título → Selección de clase → Título, Título → Opciones...) que no
## necesitan que nadie fuera de `ui-ux` las atienda. Viven en el mismo bus
## para que `UiRoot` sea el único suscriptor y no haga falta una señal ad-hoc
## por pantalla.
signal navigate_to_class_select_requested()
signal navigate_to_options_requested()
signal navigate_to_credits_requested()
signal navigate_back_requested()
## Selección de arquetipo confirmada en la pantalla de clase. Distinta de
## `run_start_requested`: esta solo dice "el jugador ha elegido esta clase
## para verla/usarla de referencia"; `run_start_requested` es la confirmación
## final de "empezar la partida con esta clase".
signal class_previewed(archetype: StringName)
## Preferencias de accesibilidad/opciones cambiadas. La UI ya las ha
## persistido (`SettingsService`); esto es solo el aviso para quien quiera
## reaccionar en caliente (p. ej. una cámara ya viva en escena).
signal settings_applied()
## Línea de texto introducida en la consola de depuración. La propia consola
## ya la ejecuta contra `DevConsole`; esta señal es solo para telemetría o
## para que otra pantalla reaccione (p. ej. cerrarse) si lo necesita.
signal console_line_submitted(line: String)

static var _singleton: UIIntents = null


static func get_singleton() -> UIIntents:
	if _singleton == null:
		_singleton = UIIntents.new()
	return _singleton
