# Horneador de uniformes

Viste a los cuerpos CC0 de Quaternius con los nueve uniformes del juego.

```bash
python3 tools/character_skins/bake_skins.py            # 1024 px, salida por defecto
python3 tools/character_skins/bake_skins.py --size 2048
```

Escribe, por arquetipo:

* `game/assets/models/characters_ubc/skins/<a>_albedo.png` — el uniforme.
* `..._normal.png` — el del cuerpo, aplanado donde hay tela. Sin esto el mapa de
  normales del torso desnudo pinta abdominales sobre la chaqueta.
* `..._roughness.png` — la tela es mate y la piel no.
* `game/assets/materials/characters/<a>.tres` y `<a>_hair.tres` — los materiales
  que carga `UbcModel`. **Se regeneran**: editarlos a mano no sirve de nada.

## Por qué se pinta en vez de modelar

El paquete gratuito de [Universal Base Characters][ubc] son dos cuerpos base en
ropa interior y ocho peinados; la ropa solo existe en versión de fantasía. La
salida es la misma que eligió Team Fortress 2: una malla y la ropa **pintada**.

La diferencia con pintarla a mano es que aquí se deriva de la geometría.
`body_regions.py` rasteriza la malla en el espacio UV y guarda, por téxel, el
hueso dominante, la posición en el modelo y la normal. Con eso, «los pantalones»
deja de ser una mancha dibujada y pasa a ser una regla —muslo y gemelo por
encima de la caña de la bota— que vale igual para el cuerpo masculino y para el
femenino, que no miden lo mismo.

`uniforms.py` es la tabla de colores y medidas. Cambiar el azul del Capitán es
cambiar un número.

## Tres cosas que costaron una captura de pantalla cada una

* **El cuero cabelludo pintado por la normal** salía como un antifaz oscuro
  sobre los ojos: las sienes miran de lado, así que les tocaba la altura de la
  nuca. Ahora el pelo es una MALLA de verdad y aquí solo se tiñe la coronilla.
* **El ombligo pesa sobre el hueso `root`**, que no tiene región, así que quedaba
  un agujero de piel en mitad de la chaqueta. Hay que mirar el segundo hueso.
* **Cabeza y torso se solapan cinco centímetros** y en el espacio de la textura
  ese solape se entrelaza téxel a téxel: el cuello salía como una sierra de piel
  y tela. Se corta por altura, no por hueso (`_straighten_neck`).

Ninguna de las tres rompía nada. Las tres se vieron a la primera captura.

[ubc]: https://quaternius.com/packs/universalbasecharacters.html
