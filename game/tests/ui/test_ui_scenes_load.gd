extends TestCase
## "Fichero que no carga = fallo" (`tests/test_case.gd`) también vale para
## escenas: el runner solo descubre `test_*.gd`, así que nada más comprueba
## que los `.tscn` de este agente parseen. Carga cada uno (sin instanciarlo)
## y comprueba que resuelve a un `PackedScene` válido.

const UI_SCENES_DIR: String = "res://scenes/ui/"


func test_every_ui_scene_loads_as_a_valid_packed_scene() -> void:
	var paths := _list_tscn(UI_SCENES_DIR)
	assert_gt(paths.size(), 5, "se esperaban varias escenas en scenes/ui/")
	for path: String in paths:
		var resource: Variant = load(path)
		assert_not_null(resource, "no se pudo cargar %s" % path)
		assert_true(resource is PackedScene, "%s no es un PackedScene" % path)


func _list_tscn(dir_path: String) -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return out
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		var full := dir_path.path_join(entry)
		if dir.current_is_dir():
			if not entry.begins_with("."):
				out.append_array(_list_tscn(full))
		elif entry.ends_with(".tscn"):
			out.append(full)
		entry = dir.get_next()
	dir.list_dir_end()
	return out
