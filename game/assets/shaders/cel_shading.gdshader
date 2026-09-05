shader_type spatial;
render_mode diffuse_toon, specular_toon, cull_back;

// Cel-shading portado del shader que el equipo original escribió en 2012
// (`legacy/trunk/Graphics/Resources/shaders/CellShading.frag`).
//
// Se conservan sus CUATRO BANDAS y sus umbrales exactos, porque son lo que
// define el aspecto del juego:
//     N·L > 0.95 -> 1.0     N·L > 0.70 -> 0.7
//     N·L > 0.30 -> 0.3     resto      -> 0.1
// El original trabajaba con la luz fija número 2 y el pipeline fijo de OpenGL;
// aquí se hace con la luz que toque, pero el escalonado es el mismo.

uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D albedo_texture : source_color, hint_default_white;
uniform bool use_texture = false;

// Umbrales y valores de las cuatro bandas, expuestos para poder afinar el
// aspecto sin tocar el código del shader.
uniform float band_high : hint_range(0.0, 1.0) = 0.95;
uniform float band_mid : hint_range(0.0, 1.0) = 0.70;
uniform float band_low : hint_range(0.0, 1.0) = 0.30;
uniform float level_high : hint_range(0.0, 1.0) = 1.0;
uniform float level_mid : hint_range(0.0, 1.0) = 0.7;
uniform float level_low : hint_range(0.0, 1.0) = 0.3;
uniform float level_shadow : hint_range(0.0, 1.0) = 0.1;

// Realce en los bordes vistos de canto. No estaba en el original —allí el
// contorno lo daba la silueta contra un fondo plano— pero en 3D con cámara
// libre hace falta algo que despegue al personaje del mobiliario.
uniform float rim_strength : hint_range(0.0, 1.0) = 0.25;
uniform float rim_width : hint_range(0.5, 8.0) = 3.0;

uniform float specular_amount : hint_range(0.0, 1.0) = 0.15;

varying vec3 world_normal;

void vertex() {
	world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 base = albedo.rgb;
	if (use_texture) {
		base *= texture(albedo_texture, UV).rgb;
	}
	ALBEDO = base;
	SPECULAR = specular_amount;
	ROUGHNESS = 0.85;

	// Realce de borde: cuanto más de canto se ve la superficie, más claro.
	float facing = 1.0 - clamp(dot(normalize(VIEW), normalize(NORMAL)), 0.0, 1.0);
	RIM = pow(facing, rim_width) * rim_strength;
}

void light() {
	// Cuantización en cuatro bandas: la receta literal del shader de 2012.
	float n_dot_l = max(dot(normalize(NORMAL), normalize(LIGHT)), 0.0);
	float factor = level_shadow;
	if (n_dot_l > band_high) {
		factor = level_high;
	} else if (n_dot_l > band_mid) {
		factor = level_mid;
	} else if (n_dot_l > band_low) {
		factor = level_low;
	}
	DIFFUSE_LIGHT += ALBEDO * LIGHT_COLOR * ATTENUATION * factor;

	// Brillo especular también escalonado, para que no rompa el aspecto plano.
	float n_dot_h = max(dot(normalize(NORMAL), normalize(LIGHT + VIEW)), 0.0);
	float spec = step(0.98, pow(n_dot_h, 32.0));
	SPECULAR_LIGHT += LIGHT_COLOR * ATTENUATION * spec * specular_amount;
}
