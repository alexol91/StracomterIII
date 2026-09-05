class_name WorldSurface
extends RefCounted
## Vocabulario de superficies del mundo, compartido por quien las pide y quien
## las pinta.
##
## Vive en su propia clase con `class_name` y no dentro del autoload
## `PresentationStyle` por un motivo concreto de GDScript: a los miembros de un
## autoload solo se llega en ejecución, así que una `const` que los use no
## compila («not a constant expression»). El conversor de mapas, el generador
## procedural y los tests necesitan nombrar superficies en tablas constantes,
## y para eso el enum tiene que ser un tipo global de verdad.

enum Kind { FLOOR, WALL, CEILING, DOOR, GLASS, TRIM, PROP }
