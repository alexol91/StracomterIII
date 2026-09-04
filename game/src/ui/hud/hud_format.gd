class_name HudFormat
extends RefCounted
## Formato puro para el HUD (GDD §10 / `legacy-gameplay.md` §9.3): tiempo,
## brújula de planta. Sin nodos — el HUD solo llama a esto y pinta.

## "MM:SS", saturando en 59:59 en vez de desbordar a horas: una partida no
## dura horas y un contador de tres dígitos rompería el layout del HUD.
static func format_time(total_seconds: float) -> String:
	var clamped := maxi(0, int(total_seconds))
	# División entera deliberada: se quieren minutos completos. El proyecto
	# trata el aviso como error precisamente para que las que sí son
	# accidentales salten, así que las intencionadas se declaran.
	@warning_ignore("integer_division")
	var minutes := mini(59, clamped / 60)
	var seconds := clamped % 60
	return "%02d:%02d" % [minutes, seconds]


## Rumbo del jugador en grados [0, 360), 0 = mirando al norte del mundo
## (convención del proyecto: -Z), creciendo en sentido horario visto desde
## arriba — igual que una brújula real.
static func heading_deg_from_forward(forward: Vector3) -> float:
	var flat := Vector2(forward.x, forward.z)
	if flat.length_squared() < 0.000001:
		return 0.0
	# atan2(x, -z): heading 0 con forward=(0,0,-1); +90 con forward=(1,0,0).
	var heading := rad_to_deg(atan2(flat.x, -flat.y))
	return fposmod(heading, 360.0)


const _CARDINAL_KEYS: Array[StringName] = [
	&"HUD_COMPASS_N", &"HUD_COMPASS_NE", &"HUD_COMPASS_E", &"HUD_COMPASS_SE",
	&"HUD_COMPASS_S", &"HUD_COMPASS_SW", &"HUD_COMPASS_W", &"HUD_COMPASS_NW",
]


## Clave de traducción del punto cardinal más cercano. Importa traducir esto
## de verdad: en español el oeste es "O", no "W".
static func cardinal_key_for_heading(heading_deg: float) -> StringName:
	var normalized := fposmod(heading_deg, 360.0)
	var index := int(round(normalized / 45.0)) % 8
	return _CARDINAL_KEYS[index]
