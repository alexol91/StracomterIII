class_name BotBrain
extends AIScheduler.Client
## Un cerebro completo enganchado a un `Character` de verdad.
##
## Todas las piezas existían y estaban probadas por separado —`BotState`,
## `PerceptionSystem`, `BehaviorController`, `CharacterActuator`,
## `WorldQuery`, `CoverProvider`— y no había NADA que las juntara fuera de las
## pruebas. Un enemigo instanciado en partida era un cuerpo sin nadie dentro:
## se le podía disparar y no hacía absolutamente nada.
##
## Este fichero es ese pegamento, y vive en `ai/` porque `gameplay/` no conoce
## `ai/` (regla 2). Al revés sí: la IA puede tocar un `Character`, y lo hace
## solo a través de sus INTENCIONES, nunca moviéndolo a mano.
##
## Es UN solo cliente del planificador, no tres. `PerceptionSystem` y
## `BehaviorController` son ambos `AIScheduler.Client` y podrían registrarse
## por su cuenta, pero entonces nadie copiaría al `BotState` lo que el cuerpo
## sabe de sí mismo —dónde está, cuánta vida le queda, si está agachado— y la
## percepción trabajaría sobre una foto vieja. Registrando el cerebro, la
## sincronización ocurre siempre justo antes de percibir.

## Cuánto cuesta un raycast de percepción en el presupuesto del planificador.
## Lo devuelve `PerceptionSystem`; aquí solo se propaga.

var character: Character = null
var state: BotState = null
var perception: PerceptionSystem = null
var controller: BehaviorController = null
var actuator: CharacterActuator = null
var context: BehaviorContext = null

var _registered: bool = false


## Monta el cerebro sobre un cuerpo. `world` y `cover` pueden ser nulos y eso
## es LEGÍTIMO y RESTRICTIVO: sin consulta al mundo el bot no ve ni encuentra
## camino, y sin nube de cobertura no se parapeta. Degrada, no revienta — y
## `world_problems()` lo dice en voz alta al arrancar.
func setup(p_character: Character, world: WorldQuery, cover: CoverProvider,
		board: Node, targets: Callable) -> void:
	character = p_character
	if character == null:
		return

	state = BotState.new()
	state.bot_id = character.get_instance_id()
	state.squad_id = character.squad_id
	state.team = int(character.team)
	state.archetype = character.archetype
	sync_from_body()

	actuator = CharacterActuator.new(character)

	perception = PerceptionSystem.new(state.bot_id, state.squad_id, state.team,
		character.stats, world)
	perception.state = state
	perception.target_provider = targets
	perception.connect_events()

	context = BehaviorContext.new()
	context.state = state
	context.board = board
	context.world = world
	context.cover = cover
	context.actuator = actuator

	controller = BehaviorController.new(state, context, null, board)
	controller.configure_archetype(character.archetype)


## Copia al `BotState` lo que el cuerpo sabe de sí mismo. Es lo único que la
## percepción no puede averiguar sola: nadie ve su propia vida.
func sync_from_body() -> void:
	if character == null or state == null or not is_instance_valid(character):
		return
	state.position = character.global_position
	# El frente de un `Node3D` en Godot es -Z.
	state.forward = -character.global_transform.basis.z
	state.health_ratio = character.health_ratio()
	state.ammo_ratio = character.ammo_ratio()
	world_position = state.position


func register() -> void:
	if _registered:
		return
	AIScheduler.register(self)
	_registered = true


func unregister() -> void:
	if not _registered:
		return
	AIScheduler.unregister(self)
	_registered = false
	if perception != null:
		perception.disconnect_events()


func is_registered() -> bool:
	return _registered


func is_alive() -> bool:
	return character != null and is_instance_valid(character) and character.alive


# ---------------------------------------------------------------------------
# Planificador (ADR-002). Nada de esto se llama por frame ni desde `_process`.
# ---------------------------------------------------------------------------

func tick_perception(delta: float) -> int:
	if not is_alive():
		return 0
	sync_from_body()
	if perception == null:
		return 0
	var rays := perception.tick_perception(delta)
	# El ruido que acaba de oír tiene que llegar a su contexto de decisión.
	# `PerceptionSystem` lo deja en `last_noise_position` y `BehaviorContext` lo
	# lee en `investigate_point()`, y NADIE los unía: un bot oía un disparo,
	# apuntaba la pista y no la usaba jamás.
	if context != null:
		context.noise_position = perception.last_noise_position
		context.noise_age_s = perception.last_noise_age_s
	return rays


func tick_decision(delta: float) -> void:
	if not is_alive() or controller == null:
		return
	controller.tick_decision(delta)


func tick_behavior(delta: float) -> void:
	if not is_alive():
		return
	# Un muerto no ejecuta comportamiento, pero tampoco debe quedarse con una
	# intención de disparo colgada del último tick.
	if controller == null:
		return
	controller.tick_behavior(delta)
