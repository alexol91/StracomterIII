shader_type spatial;
render_mode unshaded, cull_front, depth_draw_opaque;

// Contorno por casco invertido: se dibuja la malla otra vez, engordada por sus
// normales y con las caras frontales descartadas, así que solo se ve el borde.
//
// Es la técnica clásica y la adecuada aquí por dos razones: la geometría de
// 2012 es de pocos polígonos y aguanta bien el engorde, y no cuesta ningún
// paso de posprocesado, que en un juego con cuarenta bots importa.
//
// Se usa como `next_pass` del material de cel-shading.

uniform vec4 outline_color : source_color = vec4(0.05, 0.05, 0.08, 1.0);
// Grosor en metros a un metro de distancia. Se escala con la distancia para
// que el contorno no engorde de cerca ni desaparezca de lejos.
uniform float thickness : hint_range(0.0, 0.1) = 0.012;

void vertex() {
	float distance_scale = -(MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).z;
	VERTEX += normalize(NORMAL) * thickness * max(distance_scale, 0.5);
}

void fragment() {
	ALBEDO = outline_color.rgb;
	ALPHA = outline_color.a;
}
