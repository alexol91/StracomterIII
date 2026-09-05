extends TestCase
## El cel-shading conserva la receta del shader que el equipo escribió en 2012.

const SHADER: String = "res://assets/shaders/cel_shading.gdshader"
const OUTLINE: String = "res://assets/shaders/cel_outline.gdshader"


func test_both_shaders_compile() -> void:
	for path: String in [SHADER, OUTLINE]:
		assert_true(ResourceLoader.exists(path), "falta %s" % path)
		var shader := load(path) as Shader
		assert_not_null(shader, "%s no carga" % path)
		if shader != null:
			assert_eq(shader.get_shader_uniform_list().is_empty(), false,
				"%s debería exponer parámetros" % path)


func test_the_four_bands_match_the_2012_shader() -> void:
	# CellShading.frag de 2012: >0.95 -> 1.0, >0.7 -> 0.7, >0.3 -> 0.3, resto 0.1.
	# Si alguien "mejora" el degradado, el juego deja de parecerse al original.
	var shader := load(SHADER) as Shader
	assert_not_null(shader)
	if shader == null:
		return
	var expected := {
		"band_high": 0.95, "band_mid": 0.70, "band_low": 0.30,
		"level_high": 1.0, "level_mid": 0.7, "level_low": 0.3, "level_shadow": 0.1,
	}
	for name: String in expected:
		var value: Variant = RenderingServer.shader_get_parameter_default(
			shader.get_rid(), StringName(name))
		assert_almost_eq(float(value), float(expected[name]), 0.0001,
			"el umbral '%s' no coincide con el shader de 2012" % name)


func test_the_cel_material_exists_and_uses_the_shader() -> void:
	var path := "res://assets/materials/cel_character.tres"
	assert_true(ResourceLoader.exists(path), "falta el material de personaje")
	var material := load(path) as ShaderMaterial
	assert_not_null(material)
	if material != null:
		assert_not_null(material.shader, "el material debe tener shader")
		assert_not_null(material.next_pass, "debe llevar el contorno como segundo paso")
