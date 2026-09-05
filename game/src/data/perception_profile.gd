class_name PerceptionProfile
extends Resource
## Parámetros de percepción de un arquetipo.
##
## Existe para cumplir ADR-005 sin engordar `CharacterStats` con veinte campos
## más: la percepción es un subsistema con vida propia y se afina en bloque.
## `CharacterStats` mantiene lo que define al personaje (alcance y conos) y
## delega aquí el comportamiento fino del sensor.

@export_group("Vista")
## Altura de los ojos del observador, en metros.
@export var eye_height_m: float = 1.6
## Altura del pecho del objetivo, punto al que se apunta el rayo de oclusión.
@export var target_chest_height_m: float = 1.1
## Altura del pecho del objetivo agachado.
@export var target_crouched_chest_height_m: float = 0.65
## Alcance del cono periférico como fracción del primario. Menor que 1: la
## visión periférica ve peor, no mejor. En el legacy era al revés (500 vs 700 px)
## pero ese cono era código inalcanzable, así que no hay nada que preservar.
@export var secondary_range_factor: float = 0.75
## Segundos de exposición continua para adquirir un objetivo en el cono de foco.
@export var primary_acquire_s: float = 0.25
## Ídem en el cono periférico. Bastante más lento: es lo que hace que asomarse
## un instante por el lado no te delate al instante.
@export var secondary_acquire_s: float = 1.10
## Segundos que tarda en decaer la conciencia acumulada al perder el contacto.
@export var awareness_decay_s: float = 0.60
## Factor de adquisición al límite del alcance.
@export var far_acquire_factor: float = 0.45
## Factor de adquisición contra un objetivo agachado.
@export var crouched_acquire_factor: float = 0.70
## Tolerancia vertical del cono, en metros. La torre se juega por plantas: sin
## esta tolerancia un bot no vería a alguien subido a una mesa.
@export var vertical_tolerance_m: float = 3.0
## Radio dentro del cual el cono deja de ser una puerta.
##
## Ver a alguien es cosa del cono; ENTERARSE de que hay alguien a dos metros no.
## Se oye respirar, se oyen los pasos, se ve el movimiento por el rabillo del
## ojo. Sin esto, cuatro enemigos se pasaron treinta segundos de partida a
## entre 0,7 y 6,6 m del jugador sin reaccionar: el ángulo era de 81°–119° y su
## cono periférico mide 65°. Geométricamente impecable y ridículo de jugar.
##
## NO es visión a través de paredes: el rayo de oclusión se sigue lanzando y
## sigue mandando. Solo abre la puerta del cono.
##
## Por defecto CERO —sin sentido extra— por la regla de los valores por defecto:
## un perfil que no ha llegado no puede regalar percepción.
@export var proximity_awareness_m: float = 0.0

@export_group("Oído")
## Sonoridad por debajo de la cual un ruido se ignora (0..1).
@export var hearing_threshold: float = 0.08
## Exponente de atenuación sobre el coste de camino.
@export var attenuation_exponent: float = 1.5
## Penalización cuando no hay ruta de navmesh: se oye amortiguado, no se silencia.
@export var no_route_cost_factor: float = 2.5
## Error máximo de localización de un ruido, en metros. Oír no es ver: un bot
## acude a donde cree que sonó, y se equivoca en proporción a lo flojo que fue.
@export var max_localization_error_m: float = 4.0
## Confianza máxima que puede dar un contacto puramente auditivo.
@export var max_sound_confidence: float = 0.55
## Eventos sonoros procesados por tick y tamaño máximo de la cola.
@export var max_sound_events_per_tick: int = 6
@export var max_sound_queue: int = 24

@export_group("Memoria")
## Confianza perdida por segundo sin contacto nuevo.
@export var time_decay_rate: float = 0.35
## Confianza extra perdida por cada m/s de velocidad estimada del objetivo:
## cuanto más rápido se mueve, antes deja de valer su última posición conocida.
@export var motion_decay_per_mps: float = 0.10
## Segundos que se extrapola la posición creída antes de congelarla.
@export var max_extrapolation_s: float = 1.5
@export var extrapolation_damping: float = 0.6
## Por debajo de esta confianza, el contacto se descarta.
@export var prune_confidence: float = 0.05
## Confianza a partir de la cual un contacto cuenta como amenaza.
@export var threat_confidence: float = 0.25
## Factor aplicado a un contacto recibido de un compañero frente a uno propio.
@export var squad_confidence_factor: float = 0.8
## Confianza de un contacto originado por recibir daño.
@export var damage_confidence: float = 0.6

@export_group("Difusión")
## Confianza mínima para difundir un contacto a la escuadra.
@export var min_broadcast_confidence: float = 0.35
## Margen tras perder de vista al objetivo antes de volver a pagar el retardo
## de reacción para re-difundirlo.
@export var tracking_grace_s: float = 2.0
## Suelo del retardo de reacción. Nunca 0: la telepatía instantánea es lo que
## separa a un bot difícil de uno tramposo.
@export var min_reaction_delay_s: float = 0.05
## Segundos que un ruido sigue interesando al bot.
@export var noise_interest_s: float = 8.0

@export_group("Presupuesto")
## Techo de rayos que un solo bot puede gastar en un tick de percepción, para
## que ninguno acapare el presupuesto global del AIScheduler (ADR-002).
@export var max_raycasts_per_tick: int = 3
@export var max_noise_events_per_tick: int = 3
