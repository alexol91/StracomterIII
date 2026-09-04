# Nubes de cobertura horneadas

Aquí van los `.tres` de `CoverPointCloud` de los mapas que se distribuyen con
el juego, uno por mapa: `<map_id>.cover.tres`.

**Por qué se versionan.** Es contenido derivado, sí, pero determinista: el
mismo navmesh y la misma geometría producen la misma nube. Versionarla evita
hornear 26 mapas en cada arranque (decenas de miles de rayos por planta) y
hace que un cambio en la clasificación de cobertura se vea en el diff, que es
justo lo que se quiere de un dato que decide dónde se cubre la IA.

**Por qué no van en `game/maps/`.** Esa carpeta la genera el conversor de
mapas y se sobrescribe entera en cada regeneración.

**Qué NO va aquí.** Lo que se hornea en ejecución —niveles procedurales y
re-horneados tras una demolición (E-01)— se guarda en
`user://cover/<map_id>.cover.tres`. Ver `CoverPointCloud.bundled_path` y
`CoverPointCloud.user_path`.

**Caducidad.** `CoverPointCloud.FORMAT_VERSION` sube cuando cambia el formato
o el significado de las calidades; un `.tres` con otra versión se descarta al
cargar y hay que rehornearlo. `load_from` devuelve `null` en ese caso, en
lugar de servir datos que ya no significan lo mismo.
