shader_type canvas_item;

// Fondo animado de los menús (encargo "listón visual AAA"): silueta nocturna
// de la Torre Elite con ventanas que parpadean muy despacio, cielo frío en
// degradado y un grano leve. Boceto de composición tomado de
// `legacy/trunk/Graphics/Resources/texturas/fondo.jpg` (torre a la izquierda
// del centro, cielo en degradado) — la imagen NO se copia ni se referencia:
// es un shader, como pide el encargo ("pesa nada y no arrastra licencias").
//
// Paleta: cielo y torre en gris/azul frío; las ventanas usan un blanco-azul
// FRÍO a propósito, nunca el naranja de amenaza — ese color está reservado
// por completo a HUD de daño y lecturas de peligro (dirección de arte, TF2).

uniform vec4 sky_top_color : source_color = vec4(0.02, 0.03, 0.06, 1.0);
uniform vec4 sky_horizon_color : source_color = vec4(0.06, 0.10, 0.16, 1.0);
uniform vec4 tower_color : source_color = vec4(0.03, 0.04, 0.06, 1.0);
uniform vec4 tower_edge_color : source_color = vec4(0.30, 0.64, 1.0, 1.0);
uniform vec4 window_color : source_color = vec4(0.55, 0.78, 1.0, 1.0);

uniform float tower_x_offset : hint_range(-0.4, 0.4) = -0.16;
uniform float tower_half_width : hint_range(0.02, 0.3) = 0.085;
uniform float tower_roof_uv_y : hint_range(0.0, 0.5) = 0.14;
uniform float rim_strength : hint_range(0.0, 1.0) = 0.35;
uniform float grain_strength : hint_range(0.0, 0.1) = 0.02;
uniform float vignette_strength : hint_range(0.0, 1.0) = 0.35;
// Grados/segundo de la deriva del parpadeo: MUY lento a propósito ("que
// reaccione muy sutilmente al paso del tiempo, sin distraer").
uniform float flicker_speed : hint_range(0.0, 2.0) = 0.35;

// Tamaño en píxeles del `ColorRect` que lleva este material. Sin esto, UV
// (0..1 sobre el rect) estiraría la torre según la proporción de pantalla.
// Ante la duda de que nadie lo haya puesto todavía, 16:9 es un valor de
// aspecto neutro razonable, no uno extremo — se corrige en cuanto
// `MenuBackdrop` conecta la señal `resized` y lo actualiza.
uniform vec2 rect_size = vec2(16.0, 9.0);

float _hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void fragment() {
	float aspect = rect_size.x / max(rect_size.y, 1.0);
	vec2 p = vec2((UV.x - 0.5) * aspect, UV.y - 0.5);

	vec3 col = mix(sky_top_color.rgb, sky_horizon_color.rgb, clamp(UV.y, 0.0, 1.0));

	// Silueta: cuerpo rectangular con las esquinas suavizadas por AA y un
	// remate de tejado más estrecho, como el octógono del boceto original.
	float dx = abs(p.x - tower_x_offset);
	float body_edge = smoothstep(tower_half_width, tower_half_width - 0.006, dx);
	float roof_half_width = tower_half_width * 0.82;
	float roof_edge = smoothstep(roof_half_width, roof_half_width - 0.006, dx);
	float roof_band = smoothstep(tower_roof_uv_y - 0.02, tower_roof_uv_y, UV.y)
		- smoothstep(tower_roof_uv_y + 0.025, tower_roof_uv_y + 0.045, UV.y);
	float above_roof = smoothstep(tower_roof_uv_y + 0.03, tower_roof_uv_y + 0.05, UV.y);
	float in_tower = clamp(mix(roof_edge * roof_band, body_edge * above_roof, above_roof), 0.0, 1.0);

	col = mix(col, tower_color.rgb, in_tower);

	// Ventanas: rejilla dentro del cuerpo de la torre, con hueco y encendido
	// determinados por celda (hash) y un parpadeo lentísimo por celda.
	float body_top = tower_roof_uv_y + 0.05;
	vec2 local = vec2((p.x - tower_x_offset) / tower_half_width, (UV.y - body_top) / max(1.0 - body_top, 0.001));
	vec2 grid = vec2(5.0, 22.0);
	vec2 cell = floor(local * grid);
	vec2 cell_uv = fract(local * grid);
	float h = _hash(cell);
	float base_lit = step(0.5, h);
	float phase = TIME * flicker_speed + h * 6.2831853;
	float twinkle = 0.55 + 0.45 * sin(phase);
	float margin = 0.30;
	float window_mask = step(margin, cell_uv.x) * step(cell_uv.x, 1.0 - margin)
		* step(margin, cell_uv.y) * step(cell_uv.y, 1.0 - margin);
	float lit = in_tower * base_lit * window_mask * twinkle;
	col = mix(col, window_color.rgb, clamp(lit, 0.0, 1.0));

	// Filo azul Elite muy tenue en el contorno de la torre: separa la
	// silueta del cielo sin llegar a ser un contorno duro de cel-shading.
	float edge_band = smoothstep(tower_half_width - 0.05, tower_half_width, dx) * in_tower;
	col += tower_edge_color.rgb * edge_band * rim_strength * 0.3;

	// Grano: dither muy suave que se desplaza despacio, no ruido por frame.
	float grain = _hash(floor(UV * rect_size * 0.5) + floor(TIME * 6.0)) - 0.5;
	col += grain * grain_strength;

	// Viñeta: oscurece esquinas para que la mirada caiga en el contenido de
	// la pantalla (menú/estrategia), no en el fondo.
	float vig = smoothstep(0.95, 0.2, length(p));
	col *= mix(1.0 - vignette_strength, 1.0, vig);

	COLOR = vec4(col, 1.0);
}
