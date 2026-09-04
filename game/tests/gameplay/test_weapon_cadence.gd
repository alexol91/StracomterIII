extends TestCase
## Cadencia de `weapon.gd`: milisegundos entre disparos, semántica idéntica
## a `Character::rate` del legacy. No debe permitir disparar antes de tiempo.

func _make_weapon(cadence_ms: float) -> Weapon:
	var stats := WeaponStats.new()
	stats.cadence_ms = cadence_ms
	stats.reload_s = 1.0
	return Weapon.new(stats, cadence_ms)


func test_first_shot_is_never_blocked_by_cadence() -> void:
	var w := _make_weapon(500.0)
	assert_true(w.can_fire(), "el primer disparo de la partida no debe esperar cadencia")


func test_cannot_fire_before_cadence_elapses() -> void:
	var w := _make_weapon(500.0)
	w.register_shot()
	w.tick(0.2) # 200 ms < 500 ms
	assert_false(w.can_fire(), "200 ms de 500 ms de cadencia: todavía no puede disparar")


func test_cannot_fire_at_almost_the_full_cadence() -> void:
	var w := _make_weapon(500.0)
	w.register_shot()
	w.tick(0.499)
	assert_false(w.can_fire(), "1 ms antes de cumplir cadencia sigue bloqueado")


func test_can_fire_once_cadence_elapses() -> void:
	var w := _make_weapon(500.0)
	w.register_shot()
	w.tick(0.5)
	assert_true(w.can_fire(), "exactamente 500 ms: la cadencia se ha cumplido")


func test_can_fire_after_cadence_and_more() -> void:
	var w := _make_weapon(200.0)
	w.register_shot()
	w.tick(0.35)
	assert_true(w.can_fire())


func test_cannot_fire_while_reloading_even_if_cadence_ready() -> void:
	var w := _make_weapon(100.0) # cadencia muy corta: de sobra cumplida
	w.start_reload()
	w.tick(0.5) # a mitad de reload_s = 1.0: sigue recargando
	assert_true(w.is_reloading, "a mitad de reload_s todavía está recargando")
	assert_false(w.can_fire(), "recargando no se dispara aunque la cadencia esté lista")


func test_reload_completes_after_reload_s() -> void:
	var w := _make_weapon(100.0)
	w.start_reload()
	w.tick(0.5)
	assert_true(w.is_reloading, "a mitad de reload_s sigue recargando")
	w.tick(0.6)
	assert_false(w.is_reloading, "tras superar reload_s la recarga ha terminado")
