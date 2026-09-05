shader_type canvas_item;

// Fondo animado de los menús (encargo "listón visual AAA"): silueta nocturna
// de la Torre Chutaos con ventanas que parpadean muy despacio, cielo frío en
// degradado y un grano leve.
//
// Composición tomada del boceto real del equipo original
// (`assets/textures/chutaos/fondo_torre.jpg`, mostrado tal cual en modo
// Chutaos por `menu_backdrop.gd`): torre octogonal de muro cortina
// descentrada hacia la izquierda, horizonte bajo, un edificio bajo a la
// derecha ("Chutaos Inc. I+D" en el boceto) y cielo en degradado. Es un
// boceto, no una imagen que copiar — de ahí que aquí sea de noche y sin
// rótulos, no una réplica de la foto.
//
// Paleta: cielo y torre en gris/azul frío; las ventanas usan un blanco-azul
// FRÍO a propósito, nunca el naranja de amenaza — ese color está reservado
// por completo a HUD de daño y lecturas de peligro (dirección de arte, TF2).

uniform vec4 sky_top_color : source_color = vec4(0.02, 0.03, 0.06, 1.0);
uniform vec4 sky_horizon_color : source_color = vec4(0.06, 0.10, 0.16, 1.0);
uniform vec4 ground_color : source_color = vec4(0.015, 0.02, 0.03, 1.0);
uniform vec4 tower_color : source_color = vec4(0.03, 0.04, 0.06, 1.0);
uniform vec4 tower_edge_color : source_color = vec4(0.30, 0.64, 1.0, 1.0);
uniform vec4 window_color : source_color = vec4(0.55, 0.78, 1.0, 1.0);

// Horizonte muy bajo, como en el boceto: casi todo el encuadre es torre y
// cielo, el suelo del recinto vallado apenas asoma.
uniform float horizon_uv_y : hint_range(0.5, 0.98) = 0.87;

uniform float tower_x_offset : hint_range(-0.6, 0.4) = -0.30;
// Ancha a propósito. Con 0.095 la torre salía como una antena y no como el
// edificio que da nombre al juego: en el boceto ocupa del tercio izquierdo al
// centro del encuadre.
uniform float tower_half_width : hint_range(0.02, 0.4) = 0.17;
uniform float tower_roof_uv_y : hint_range(0.0, 0.5) = 0.10;
// Muro cortina: montantes verticales. Es la pista más barata y más fuerte de
// que un edificio es de cristal y no un bloque de hormigón.
uniform float mullion_count : hint_range(4.0, 60.0) = 26.0;

// Edificio bajo a la derecha, eco del "Chutaos Inc. I+D" del boceto: mucho
// más corto y sin ventanas propias, solo silueta.
uniform float annex_x_offset : hint_range(-0.4, 0.8) = 0.46;
uniform float annex_half_width : hint_range(0.02, 0.3) = 0.16;
uniform float annex_top_uv_y : hint_range(0.4, 0.95) = 0.70;

uniform float rim_strength : hint_range(0.0, 1.0) = 0.85;
// Halo de ciudad en el horizonte. Sin él la silueta se pierde contra el cielo
// y la escena entera se lee como una mancha negra.
uniform float city_glow : hint_range(0.0, 1.0) = 0.55;
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

	// Degradado con potencia: lineal deja el cielo lechoso a media altura y
	// la torre no se recorta contra nada.
	float sky_t = pow(clamp(UV.y, 0.0, 1.0), 1.6);
	vec3 col = mix(sky_top_color.rgb, sky_horizon_color.rgb, sky_t);

	// Halo de la ciudad justo sobre el horizonte: es lo que da profundidad y
	// lo que hace que la silueta de la torre se lea. Se apaga hacia arriba.
	float glow = exp(-pow(max(horizon_uv_y - UV.y, 0.0) * 7.0, 1.5));
	col += sky_horizon_color.rgb * glow * city_glow;

	// Suelo del recinto, por debajo del horizonte: distinto del cielo para
	// que la torre se recorte contra algo, no contra un degradado infinito.
	// La transición es suave —antes era una línea dura de 0.02 de ancho que
	// parecía un fallo de render, no un horizonte.
	float ground = smoothstep(horizon_uv_y - 0.035, horizon_uv_y + 0.02, UV.y);
	col = mix(col, ground_color.rgb, ground);

	// --- Torre principal ---------------------------------------------------
	// Silueta: cuerpo con las esquinas suavizadas por AA y un remate de
	// tejado más estrecho, como el cuerpo octogonal del boceto original.
	float dx = abs(p.x - tower_x_offset);
	float body_edge = smoothstep(tower_half_width, tower_half_width - 0.006, dx);
	float roof_half_width = tower_half_width * 1.04;
	float roof_edge = smoothstep(roof_half_width, roof_half_width - 0.006, dx);
	float roof_band = smoothstep(tower_roof_uv_y - 0.008, tower_roof_uv_y, UV.y);
	float above_roof = smoothstep(tower_roof_uv_y + 0.055, tower_roof_uv_y + 0.062, UV.y);
	float in_tower = clamp(mix(roof_edge * roof_band, body_edge * above_roof, above_roof), 0.0, 1.0);

	// Fachetas: una torre de planta octogonal vista de frente no es un
	// prisma plano — los dos filos laterales quedan algo más oscuros, como
	// un chaflán. Sustituye a modelar la planta real (fuera de este ámbito).
	float edge_t = clamp(dx / max(tower_half_width, 0.001), 0.0, 1.0);
	// Tres caras visibles de un octógono: la frontal, y dos chaflanes que caen
	// hacia los lados. Escalones marcados en vez de un degradado suave, porque
	// lo que hace legible una planta octogonal son las ARISTAS entre caras.
	float facet_shade = 1.0
		- 0.30 * smoothstep(0.52, 0.56, edge_t)
		- 0.28 * smoothstep(0.84, 0.88, edge_t);
	// El cristal recoge la luz del cielo: más claro arriba, casi negro abajo,
	// donde el edificio queda en la sombra de su propio recinto.
	float glass_gradient = mix(0.55, 1.45, pow(1.0 - clamp(UV.y, 0.0, 1.0), 0.8));
	// Montantes del muro cortina.
	float mullion = smoothstep(0.42, 0.5, abs(fract((p.x - tower_x_offset) * mullion_count) - 0.5));
	vec3 tower_rgb = tower_color.rgb * facet_shade * glass_gradient
		+ sky_horizon_color.rgb * 0.35 * facet_shade * glass_gradient;
	tower_rgb *= mix(0.78, 1.0, mullion);
	col = mix(col, tower_rgb, in_tower);

	// Coronación: la banda del rótulo "CHUTAOS Inc." del boceto. No se escribe
	// el texto —una tipografía dibujada en un shader se lee mal a cualquier
	// tamaño—, pero sí la franja iluminada que lo sostenía.
	float crown = smoothstep(tower_roof_uv_y + 0.045, tower_roof_uv_y + 0.055, UV.y)
		- smoothstep(tower_roof_uv_y + 0.085, tower_roof_uv_y + 0.095, UV.y);
	col = mix(col, tower_edge_color.rgb * 0.45, clamp(in_tower * crown, 0.0, 1.0));

	// --- Anexo bajo a la derecha --------------------------------------------
	float adx = abs(p.x - annex_x_offset);
	float annex_edge = smoothstep(annex_half_width, annex_half_width - 0.006, adx);
	float annex_band = smoothstep(annex_top_uv_y - 0.015, annex_top_uv_y, UV.y);
	float in_annex = annex_edge * annex_band * (1.0 - ground);
	vec3 annex_rgb = tower_color.rgb * 1.6 + sky_horizon_color.rgb * 0.28;
	col = mix(col, annex_rgb, in_annex);

	// --- Ventanas de la torre ------------------------------------------------
	// Rejilla dentro del cuerpo de la torre, con hueco y encendido
	// determinados por celda (hash) y un parpadeo lentísimo por celda.
	float body_top = tower_roof_uv_y + 0.10;
	vec2 local = vec2((p.x - tower_x_offset) / tower_half_width, (UV.y - body_top) / max(1.0 - body_top, 0.001));
	vec2 grid = vec2(9.0, 26.0);
	vec2 cell = floor(local * grid);
	vec2 cell_uv = fract(local * grid);
	float h = _hash(cell);
	float base_lit = step(0.62, h);
	float phase = TIME * flicker_speed + h * 6.2831853;
	float twinkle = 0.55 + 0.45 * sin(phase);
	float margin = 0.30;
	float window_mask = step(margin, cell_uv.x) * step(cell_uv.x, 1.0 - margin)
		* step(margin, cell_uv.y) * step(cell_uv.y, 1.0 - margin);
	// Sin ventanas en los filos (chaflán): solo en la cara frontal.
	float front_face = 1.0 - smoothstep(0.5, 0.56, edge_t);
	// Solo por debajo de la coronación. Sin esta puerta, `fract` de una
	// coordenada negativa sigue dando celdas válidas y aparecían ventanas
	// FLOTANDO sobre el tejado, desenganchadas del edificio: el remate se leía
	// como un fallo de render y no como la parte alta de una torre.
	float below_crown = step(body_top, UV.y);
	float lit = in_tower * base_lit * window_mask * twinkle * front_face * below_crown;
	col = mix(col, window_color.rgb, clamp(lit, 0.0, 1.0));

	// Filo azul de la torre muy tenue en el contorno de la torre: separa la
	// silueta del cielo sin llegar a ser un contorno duro de cel-shading.
	// Filo azul de la torre en el canto de la torre, más una insinuación del mismo
	// filo en el anexo: es lo que despega los dos volúmenes del cielo.
	float edge_band = smoothstep(tower_half_width - 0.012, tower_half_width - 0.001, dx) * in_tower;
	col += tower_edge_color.rgb * edge_band * rim_strength * 0.5;
	float annex_edge_band = smoothstep(annex_half_width - 0.010, annex_half_width - 0.001, adx) * in_annex;
	col += tower_edge_color.rgb * annex_edge_band * rim_strength * 0.25;

	// Grano: dither muy suave que se desplaza despacio, no ruido por frame.
	float grain = _hash(floor(UV * rect_size * 0.5) + floor(TIME * 6.0)) - 0.5;
	col += grain * grain_strength;

	// Viñeta: oscurece esquinas para que la mirada caiga en el contenido de
	// la pantalla (menú/estrategia), no en el fondo.
	float vig = smoothstep(0.95, 0.2, length(p));
	col *= mix(1.0 - vignette_strength, 1.0, vig);

	COLOR = vec4(col, 1.0);
}
