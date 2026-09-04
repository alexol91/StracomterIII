class_name SquadFakeOrderSource
extends RefCounted
## Doble de la habilidad *Órdenes* del Capitán
## (`gameplay/abilities/ability_captain_orders.gd`).
##
## Emite la MISMA señal con la MISMA firma. Se usa para probar el enganche sin
## montar una escena con un `Character`, un arma y física: lo que se prueba
## aquí es que `CompanionSquad` convierte la marca en una orden de foco, no
## que el raycast de la habilidad acierte —eso ya lo prueba `gameplay/`—.

signal target_marked(position: Vector3, target_id: int)


func mark(position: Vector3, target_id: int) -> void:
	target_marked.emit(position, target_id)
