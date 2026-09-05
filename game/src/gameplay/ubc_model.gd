class_name UbcModel
extends RefCounted
## Monta un personaje del paquete **Universal Base Characters** (Quaternius, CC0).
##
## El paquete gratuito son dos cuerpos base —masculino y femenino— en ropa
## interior y SIN animaciones. El juego necesita nueve personajes vestidos y
## andando, así que aquí se juntan tres piezas que vienen por separado:
##
##   cuerpo base (`.gltf`)  +  uniforme pintado (`.tres`)  +  biblioteca de
##   animaciones (`UAL1_Standard.glb`, también CC0 y del mismo autor)
##
## Que funcione depende de un hecho comprobado, no de una esperanza: los 65
## huesos del cuerpo y los de la biblioteca se llaman IGUAL (rig de maniquí de
## Unreal) y ambos cuelgan de `Armature/Skeleton3D`. Por eso las pistas de las
## animaciones resuelven tal cual y no hace falta reasignar huesos.
##
## Si algún día se cambia el cuerpo por otro con distinto rig, el síntoma no
## será un error: será un personaje inmóvil. `test_ubc_models.gd` compara las
## dos listas de huesos justo para que eso salte en CI y no en partida.

const MODELS: String = "res://assets/models/characters_ubc/"
const MATERIALS: String = "res://assets/materials/characters/"
const ANIMATION_SOURCE: String = MODELS + "UAL1_Standard.glb"

## Nodo del `.glb` importado bajo el que cuelgan las pistas de animación. Las
## pistas de la biblioteca son de la forma `Armature/Skeleton3D:hueso`, así que
## el `root_node` del reproductor tiene que apuntar al padre de `Armature`.
const SKELETON_PATH: String = "Armature/Skeleton3D"
## Nombre de la malla del cuerpo dentro del `.gltf`. Es donde se pone el
## uniforme.
const BODY_MESH_NAMES: Array = ["SuperHero_Male", "Superhero_Female"]
## Cejas y ojos. Van aparte del cuerpo porque tienen su propia malla y sus
## propias UV.
const EYEBROW_MESH_NAME: String = "Eyebrows"
const EYE_MESH_NAME: String = "Eyes"
const EYES_MATERIAL: String = MATERIALS + "eyes.tres"
const HAIR: String = MODELS + "hair/"

## Peinado y barba de cada arquetipo.
##
## El paquete gratuito trae los cuerpos CALVOS —el pelo va en mallas aparte— y
## un personaje calvo con el cuero cabelludo pintado se ve exactamente como lo
## que es: un gorro de baño. Poner la malla de verdad cuesta un reparentado y
## es lo que separa "modelo base" de "personaje".
##
## Todas las mallas de pelo del paquete llevan EL MISMO esqueleto de 65 huesos
## que el cuerpo, así que basta con colgarlas del `Skeleton3D` del personaje:
## los índices de la piel coinciden y se deforman solas.
const HAIR_BY_ARCHETYPE: Dictionary[StringName, Array] = {
	&"captain": ["Hair_SimpleParted", "Hair_Beard"],
	&"technician": ["Hair_Buns"],
	&"specialist": ["Hair_Buzzed"],
	&"demolition": ["Hair_Buzzed", "Hair_Beard"],
	&"enemy_thug": ["Hair_Buzzed"],
	&"enemy_militiaman": ["Hair_Long"],
	&"enemy_veteran": ["Hair_SimpleParted", "Hair_Beard"],
	&"miniboss": ["Hair_Buzzed"],
	&"megaboss": ["Hair_SimpleParted", "Hair_Beard"],
}

## Qué cuerpo base usa cada arquetipo. Sale de `uniforms.py`, que es la fuente
## de verdad del horneado; aquí se repite porque el juego no lee Python.
const BASE_BY_ARCHETYPE: Dictionary[StringName, String] = {
	&"captain": "Superhero_Male_FullBody",
	&"technician": "Superhero_Female_FullBody",
	&"specialist": "Superhero_Male_FullBody",
	&"demolition": "Superhero_Male_FullBody",
	&"enemy_thug": "Superhero_Male_FullBody",
	&"enemy_militiaman": "Superhero_Female_FullBody",
	&"enemy_veteran": "Superhero_Male_FullBody",
	&"miniboss": "Superhero_Male_FullBody",
	&"megaboss": "Superhero_Male_FullBody",
}


static func base_path_for(archetype: StringName) -> String:
	var base: String = BASE_BY_ARCHETYPE.get(archetype, "")
	return "" if base.is_empty() else MODELS + base + ".gltf"


static func material_path_for(archetype: StringName) -> String:
	return MATERIALS + String(archetype) + ".tres"


## Material de las cejas: color plano del pelo del arquetipo.
static func hair_material_path_for(archetype: StringName) -> String:
	return MATERIALS + String(archetype) + "_hair.tres"


## ¿Está el paquete completo para este arquetipo? Se comprueba pieza a pieza
## porque una instalación a medias tiene que degradar a los modelos anteriores,
## no dejar al personaje invisible.
static func has(archetype: StringName) -> bool:
	var base := base_path_for(archetype)
	if base.is_empty() or not ResourceLoader.exists(base):
		return false
	return ResourceLoader.exists(material_path_for(archetype))


## Construye el nodo listo para colgar del personaje.
##
## `library` se recibe en vez de cargarse aquí: la biblioteca es la MISMA para
## los nueve arquetipos y sacarla del `.glb` cuesta instanciar 7,6 MB. Quien
## llama (`PresentationStyle`) la guarda una vez y la reparte.
static func build(archetype: StringName, library: AnimationLibrary) -> Node3D:
	if not has(archetype):
		return null
	var packed := load(base_path_for(archetype)) as PackedScene
	if packed == null:
		return null
	var model := packed.instantiate() as Node3D
	if model == null:
		return null

	_dress(model, archetype)
	_add_hair(model, archetype)
	if library != null:
		_attach_animations(model, library)

	var wrapper := Node3D.new()
	wrapper.set_script(load("res://src/gameplay/modern_animator.gd"))
	wrapper.set("atlas_filter", false)  # texturas PBR de 1024: filtrado lineal
	wrapper.add_child(model)
	return wrapper


## Viste al personaje: cuerpo, cejas y ojos.
##
## Los TRES materiales se asignan desde aquí, ninguno se hereda del `.gltf`.
## No es una preferencia: el importador de Godot no resuelve las imágenes
## externas de estos ficheros y entrega materiales sin una sola textura. El
## cuerpo daba igual —lleva uniforme encima— pero los ojos salían como dos
## esferas blancas que en la cara se leen como una venda. No dio ni un aviso;
## se vio en la primera captura de pantalla.
##
## Se usa `surface_override_material` y no se toca el material del `.gltf`: ese
## material es un recurso COMPARTIDO por todos los personajes que usen el mismo
## cuerpo base, así que escribirlo vestiría de Capitán a los nueve.
static func _dress(model: Node3D, archetype: StringName) -> void:
	var body := load(material_path_for(archetype)) as Material
	var hair := _load_if_exists(hair_material_path_for(archetype))
	var eyes := _load_if_exists(EYES_MATERIAL)
	for node: Node in _descendants(model):
		var mesh := node as MeshInstance3D
		if mesh == null:
			continue
		var mesh_name := String(mesh.name)
		if BODY_MESH_NAMES.has(mesh_name) and body != null:
			mesh.set_surface_override_material(0, body)
		elif mesh_name == EYEBROW_MESH_NAME and hair != null:
			mesh.set_surface_override_material(0, hair)
		elif mesh_name == EYE_MESH_NAME and eyes != null:
			mesh.set_surface_override_material(0, eyes)


## Cuelga las mallas de peinado y barba del esqueleto del personaje.
##
## Se REPARENTAN en vez de instanciar la escena entera: cada `.gltf` de pelo
## trae su propio esqueleto completo, y dejar dos esqueletos vivos por
## personaje sería pagar el doble de huesos por un flequillo.
static func _add_hair(model: Node3D, archetype: StringName) -> void:
	var pieces: Array = HAIR_BY_ARCHETYPE.get(archetype, [])
	if pieces.is_empty():
		return
	var skeleton := model.get_node_or_null(SKELETON_PATH) as Skeleton3D
	if skeleton == null:
		return
	var material := _load_if_exists(hair_material_path_for(archetype))
	for piece: String in pieces:
		var path := HAIR + piece + ".gltf"
		if not ResourceLoader.exists(path):
			continue
		var packed := load(path) as PackedScene
		if packed == null:
			continue
		var scene := packed.instantiate()
		var source := scene.get_node_or_null(SKELETON_PATH) as Skeleton3D
		if source != null:
			for child: Node in source.get_children():
				var mesh := child as MeshInstance3D
				if mesh == null:
					continue
				source.remove_child(mesh)
				# El nodo conserva el `owner` de la escena de la que viene, y
				# colgarlo de otra sin quitarlo suelta un aviso por cada pelo
				# de cada personaje: «hará el owner inconsistente». No rompe
				# nada, pero el arranque deja de estar limpio.
				mesh.owner = null
				skeleton.add_child(mesh)
				# Relativa a la malla: `..` es el esqueleto al que se acaba de
				# colgar. Sin esto la malla se queda en pose de reposo mientras
				# el personaje anda, y parece que el pelo se le cae.
				mesh.skeleton = NodePath("..")
				if material != null:
					mesh.set_surface_override_material(0, material)
		scene.free()


static func _load_if_exists(path: String) -> Material:
	return load(path) as Material if ResourceLoader.exists(path) else null


static func _attach_animations(model: Node3D, library: AnimationLibrary) -> void:
	if model.get_node_or_null(SKELETON_PATH) == null:
		# Sin esqueleto en la ruta esperada las pistas no resolverían y el
		# personaje se quedaría clavado. Mejor no montar el reproductor que
		# montar uno que no anima nada: así `frame_count()` da 0 y la prueba
		# lo dice.
		push_warning("UbcModel: no hay %s en %s" % [SKELETON_PATH, model.name])
		return
	var player := AnimationPlayer.new()
	player.name = "AnimationPlayer"
	# Las pistas son relativas al PADRE del esqueleto, que es este mismo nodo.
	player.root_node = NodePath("..")
	player.add_animation_library("", library)
	model.add_child(player)


static func _descendants(node: Node) -> Array[Node]:
	var out: Array[Node] = []
	for child: Node in node.get_children():
		out.append(child)
		out.append_array(_descendants(child))
	return out
