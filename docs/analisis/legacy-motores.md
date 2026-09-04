# Análisis legacy — Motores propios y dependencias

> Ámbito: `legacy/trunk/Graphics/`, `legacy/trunk/Physics/`, `legacy/trunk/sound/`, `legacy/trunk/3rdParty/`, `legacy/trunk/CMakeLists.txt`, `construir.sh`, `installer.sh`, y el sistema de partículas (`core/lib/ParticleManager.cc`, `core/lib/ParticleNode.cc`).
> Todas las rutas son relativas a `legacy/trunk/`. Todo lo afirmado está leído del código; donde un dato es una inferencia se indica.
> Contexto temporal: cabeceras fechadas entre 28/10/2011 (`Physics/include/Box.h:5`) y 18/05/2012 (`core/include/ParticleManager.h:4`); el repositorio git es una importación posterior (commits 2014-07-07 y 2015-04-16).

---

## 1. Motor gráfico

### 1.1 Pipeline y versión de OpenGL — veredicto explícito

**Es una mezcla: pipeline fijo de OpenGL 1.x/2.x (dominante) más shaders GLSL 1.10 en modo compatibilidad, cargados y enlazados a través de `sf::Shader` de SFML.** No hay ninguna petición explícita de versión de contexto.

Evidencia:

- **Pipeline fijo.** 92 llamadas `glBegin`/`glEnd` en `Graphics/lib` + `core/lib` + `WankelParticles/lib` (grep). Display lists: `glGenLists`/`glNewList`/`glCallList` (`Graphics/lib/Model.cc:180,189,285`). Pila de matrices: `glMatrixMode`, `glLoadIdentity`, `glPushMatrix`/`glPopMatrix`, `glMultMatrixd`, `glLoadMatrixd` (`Graphics/lib/Transformacion.cc:135-177`, `GraphicTree.cc:672-674`). Iluminación fija: `glEnable(GL_LIGHTING)`, `glLightfv(GL_LIGHT0+n, …)` (`Graphics/lib/Light.cc:162-216`), `glMaterialfv`, `glColorMaterial` (`Graphics/lib/Material.cc:128-134`, `SceneManager.cc:803-807`). Texturas con `glTexGeni(GL_SPHERE_MAP)` y `gluBuild2DMipmaps` (`Graphics/lib/Textura.cc:94-96`). Primitivas `GL_QUADS`, `GL_POLYGON`, `GL_LINE_LOOP` (`MotorGrafico.cc:22,66,158`, `Shape.cc:188`).
- **GLU y GLUT.** `gluPerspective` y `glOrtho` en `Graphics/lib/Camera.cc:169,176`; texto de depuración con `glutBitmapCharacter(GLUT_BITMAP_HELVETICA_12)` y `glutStrokeCharacter(GLUT_STROKE_ROMAN)` (`Graphics/lib/MotorGrafico.cc:207,227`); `glutInit` se invoca desde `core/lib/TWindow.cc:24,119`. Cabeceras `<GL/glut.h>`, `<GL/gl.h>`, `<GL/glu.h>`, `<GL/glext.h>` (`Graphics/include/MotorGrafico.h:14-16`, `Scene.h:16-19`, `Shape.h:19-21`).
- **GLSL.** Tres pares de shaders en `Graphics/Resources/shaders/` (`Phong`, `CellShading`, `Pruebas`). Sin directiva `#version` → GLSL 1.10 por defecto; usan exclusivamente built-ins de compatibilidad: `ftransform()`, `gl_NormalMatrix`, `gl_ModelViewMatrix`, `gl_LightSource[i]`, `gl_FrontMaterial`, `gl_FrontLightModelProduct.sceneColor`, `gl_TexCoord[0]`, `gl_MultiTexCoord0`, `varying` (`Phong.vert:1-17`, `Phong.frag:1-42`, `CellShading.vert:1-23`, `CellShading.frag:1-59`, `Pruebas.frag:1-42`). El motor gráfico **no llama a ninguna función de shaders de OpenGL** (grep de `glCreateShader|glUseProgram|glLinkProgram|glUniform` en `Graphics/` y `core/` = 0 resultados): la compilación/enlace la hace `sf::Shader::LoadFromFile(vert, frag)` y la activación `Bind()/Unbind()` en `core/lib/ResourceManager.cc:55-85`. Enumerado `Graphics::Shader::Name {CellShading, Phong, Pruebas, None}` (`Graphics/include/GraphicsNamespace.h:148-157`). Por defecto `currentShader = Pruebas; shadersActive = false` (`SceneManager.cc:35-36`). En la práctica **solo se activa Phong**, y solo si `isShaderActive()` (`GraphicTree.cc:592-593,612-618`, `Shape.cc:182-183`); en `GraphicNode::Render` se activa Phong incondicionalmente (`GraphicTree.cc:756-760`). El toggle de usuario es `WidgetOptions::checkBoxShaders` (`GraphicsNamespace.h:165`).
- **Contexto.** La ventana se crea con `sf::RenderWindow(sf::VideoMode(w,h), nombre, estilo)` sin `sf::ContextSettings` (`core/lib/TWindow.cc:38-84`) → contexto legacy por defecto del driver (perfil de compatibilidad, sin depth/stencil bits solicitados). **Requisito efectivo: OpenGL 2.0/2.1 en perfil de compatibilidad** (fixed-function + GLSL 1.10 + `sf::Shader`, que en esta SFML exige `GL_ARB_shader_objects`), más GLU y GLUT.

### 1.2 Grafo de escena

- **`Element`** (`Graphics/include/Element.h:21-65`): clase base de todo lo que cuelga del árbol. Guarda `Core::Element::Type element`, punteros `GraphicNode *nodo, *padre`. `getName()` devuelve el nombre del tipo (`Element.cc:41-85`). Bug: `operator=` invoca el destructor explícitamente y sigue usando el objeto (`Element.cc:30`), patrón repetido en `Transformacion.cc:39`, `Camera.cc:67`, `Light.cc:93`, `Shape.cc:132`, `Physics/lib/Body.cc:65`, `BodyData.cc:87`, `Box.cc:175`, `Force.cc:31`.
- **`GraphicTree` / `GraphicNode`** (`Graphics/include/GraphicTree.h:31-199`): árbol n-ario recursivo — `GraphicTree` tiene `GraphicNode *raiz`; `GraphicNode` tiene `Element *item`, `vector<GraphicTree*> hijos`, `visible`, `id`. Búsquedas lineales recursivas (`BuscarElemento*`, `getPadre*`, `Existe*`, `GraphicTree.cc:321-543`). `Insertar(Element*, Element* padre)` busca el padre por puntero antes de insertar (`GraphicTree.cc:222-251`) → inserción O(n). El renderizado `GraphicTree::Render()` (`GraphicTree.cc:562-683`) es un `switch` por tipo de elemento: `e_camera` → `Camera::exportOpenGL()` + `glLoadIdentity` (`:572-577`); `e_transform` → `Transform::addOpenGL()` y los hijos se envuelven en `glPushMatrix/glPopMatrix` (`:578-582`, `:671-674`); `e_light` → `Light::exportOpenGL()` (`:583-586`); `e_entity` → `glCallList(getIdDisplay())` con activación opcional del shader Phong y truco de alpha==0 para puertas (`:587-632`); `e_shape`, `e_model`, `e_text` → sus `exportOpenGL()`; `e_menu` → `GameMenu::Render()`; `e_form` → `TForm::Draw()`; `e_particle` → `ParticleNode::Render()` (`:657-658`). **El motor gráfico depende del core:** `GraphicTree.h:17-25` incluye `Bot.h`, `GameMenu.h`, `Wall.h`, `Floor.h`, `Pointer.h`, y `GraphicTree.cc:9` incluye `Aplication.h`. Bug: el constructor de copia de `GraphicNode` copia `hijos[i]` de sí mismo en vez de `node.hijos[i]` (`GraphicTree.cc:85-87`).
- **`SceneManager`** (singleton, `Graphics/include/SceneManager.h:24-207`): posee el `GraphicTree *scene`, un vector `directNodes` de accesos directos indexado por `Graphics::DirectNodes::Index` (20 entradas: `c_escena, c_mapa, c_hud, t_escena, t_hud, t_console, t_menu, t_puntuacion, t_hp, t_ray, t_light0..2, t_mapa, t_enemigos, t_balas, t_screen, t_fps, t_time, t_recompensa`, `GraphicsNamespace.h:49-76`), flags globales `zbuffer/culling/smooth/lighting/mode` y estado de shaders. Construye tres árboles alternativos:
  - `makeStracomterTree()` (`SceneManager.cc:634-814`): raíz `Transform pnull`; cámaras `c_escena` perspectiva 45°, near 1, far 20000 (`:652-654`), `c_mapa` orto 200×150 en la esquina (`:656-658`), `c_hud` orto escala 400 (`:660-662`); tres `Light` en (0,0,700), (0,0,700), (0,0,100) (`:668-678`) colgadas de `t_escena`; HUD con `TForm` + `TPicture` (iconos `clock.png`, `skull.png`, `points.png`, `vida.png`, `ammo.png`, `null.png`, `:718-733`) y seis `Text` con fuente `Absender` tamaño 30 (`:706-713`); `t_hud` aplica `addScale(1,-1,1)` y traslación al centro (`:736-737`). Fija material global con `glEnable(GL_COLOR_MATERIAL)` + `glMaterialfv` (`:803-807`, comentario "TODO esto no va aquí").
  - `makeMenuTree()` (`:886-945`) y `makeEditorTree()` (`:976-1036`, resolución 800×600 hard-coded).
  - `DrawScene()` (`:182-307`): limpia, y según `tree` hace pasadas: escena 3D (zbuffer + lighting, culling off, `GL_DITHER`), HUD (blend `SRC_ALPHA/ONE_MINUS_SRC_ALPHA`, lighting off), minimapa; el árbol de menú solo blend; el de editor dos pasadas. Bug: `setMode()` hace `glBegin` sin `glEnd` (`:112-125`); `setZbuffer(true)` también activa `GL_BLEND` (`:150-156`).
- **`Scene`** (`Graphics/include/Scene.h:43-101`, `Scene.cc`): renderizador **anterior**, en modo inmediato 2D, con tres cámaras propias y una `TransformStack`; dibuja polígonos de entidades, cono de visión y camino de bots, y la triangulación del `NavGraph` como depuración (`Scene.cc:95-134`). Usa el tipo de entidad como id de display list (`glCallList(t)`, `Scene.cc:215`). Sigue compilándose por el `file(GLOB)` pero el juego usa `SceneManager`.
- **`Transform`** (`Graphics/include/Transformacion.h:13-100`): matriz 4×4 propia `Matrix<double>` (librería Math) con `addTranslation/addScale/addRotationX/Y/Z` que post-multiplican (`Transformacion.cc:54-128`); `exportOpenGL()` → `glLoadMatrixd` (`:131-153`), `addOpenGL()` → `glMultMatrixd` (`:156-180`), ambos transponiendo a column-major. `importOpenGL()` lee con `glGetDoublev` y **descarta el resultado** (`:244-254`). Modo de matriz `Graphics::MatrixMode {m_modelview, m_projection, m_texture}` (`GraphicsNamespace.h:33-40`).
- **`TransformStack`** (`Graphics/include/TransformStack.h:18-53`): `std::stack<Transform>` con `Push/Pop/Apply/Top`. Solo lo usa `Scene` (`Scene.h:92`); el camino `SceneManager` usa `glPushMatrix` directamente.
- **`Camera`** (`Graphics/include/Camera.h:19-114`): `width, height, near, far, angle, scale, position, projection`. `exportOpenGL()` (`Camera.cc:159-182`): orto → `glViewport` + `glOrtho(-scale, scale, -scale/aspect, scale/aspect, near, far)`; perspectiva → `gluPerspective(angle, aspect, near, far)`. Los miembros se llaman literalmente `near` y `far` (`Camera.h:103,105`).

### 1.3 Luces y materiales

- **`Light`** (`Graphics/include/Light.h:22-122`): colores ambiente/difusa/especular, posición, `id`, `light = id % 8` (`Light.cc:29,55,188`), `active`, `focus`. `exportOpenGL()` (`Light.cc:158-219`) hace `glEnable(GL_LIGHTING)`, `glLightfv(GL_LIGHT0+light, GL_DIFFUSE/SPECULAR/AMBIENT/POSITION)` con `w=1` (luz posicional) y, si `focus`, spot con `GL_SPOT_CUTOFF 90`, `GL_SPOT_EXPONENT 60` y **`glLightf(…, GL_LINEAR, 70)` — parámetro inválido (debería ser `GL_LINEAR_ATTENUATION`), genera `GL_INVALID_ENUM`** (`Light.cc:210`). Al ser un `Element` del árbol, la posición se fija con la modelview vigente en el momento del recorrido. El juego mueve `t_light2` cada frame a la posición del jugador con z=700 (`core/lib/GameAction.cc:787-789`).
- **`LightManager`** (`Graphics/include/LightManager.h:25-99`): gestiona hasta 8 slots (`asignadas`, `activas`), `addLight`, `deleteLight`, `exportOpenGL(...)` en cinco sobrecargas (`LightManager.cc:110-222`). **Solo lo usan los programas de prueba** (`Graphics/src/modelLoader.cc:334`, `textureLoader.cc:342`, `loader.cc:343`, `animation.cc:347`); el juego crea las `Light` directamente en `SceneManager::makeStracomterTree`.
- **`Material`** (`Graphics/include/Material.h:19-106`): ambiente (0.1), difusa (0.7), especular (0.9), brillo 100 por defecto (`Material.cc:11-17`). `exportOpenGL()` (`Material.cc:126-135`) llama `glColorMaterial(GL_FRONT, X)` seguido de `glColor` para cada componente — como `glColorMaterial` es un estado, solo el último (`GL_DIFFUSE`) queda vigente; luego `glMaterialf(GL_SHININESS)`. Solo se aplica si `Model::materialActive` (`Model.cc:207-210`).
- **`Color<T>`** (`Graphics/include/Color.h:19-108`): template float [0..1] / int [0..255] con `exportOpenGL()` → `glColor4f`/`glColor4i` (`Color.h:92-98`). `Color.cc` contiene una única línea (`#include "Color.h"`).

### 1.4 Texturas

- **`Textura`** (`Graphics/include/Textura.h:19-90`): carga con `sf::Image::LoadFromFile` y `GetPixelsPtr()` (`Textura.cc:78-82`) — la SFML sirve de cargador de imágenes (PNG/JPG/TGA vía stb_image interno de SFML). `glGenTextures`, filtros `GL_NEAREST`, wrap `GL_REPEAT`, `glTexGeni(GL_SPHERE_MAP)` sin habilitar texgen (no-op), `gluBuild2DMipmaps(GL_RGBA)` (`Textura.cc:84-96`). Bug: `setTexture(id)` asigna `this->texture = texture` (no-op, `Textura.cc:107-110`). `loadjpeg.h` declara `LoadJPEG` (`Graphics/include/loadjpeg.h:11`) pero **no existe implementación** en el árbol; su uso está comentado (`Textura.cc:77`).
- Enumerado de texturas del mapa `Graphics::Texturas::Type {t_wall, t_floor, t_wallFloor, t_door, t_wallCeil, t_doorCeil, t_explosion}` (`GraphicsNamespace.h:12-23`); las activa `ResourceManager` al compilar las display lists del mapa (`core/lib/ResourceManager.cc:176-538`). Assets en `Graphics/Resources/texturas/` (PNG/JPG/TGA; p. ej. `*_flat.tga` para las clases de personaje).

### 1.5 Modelos 3DS

- **`load3ds.c`** (`Graphics/lib/load3ds.c`): cargador de Alexander Zaprjagaev ("frustum"), "modified by Chutaos Team" (`:1-6`). Lee chunks `MAIN 0x4d4d`, `OBJMESH 0x3d3d`, `OBJBLOCK 0x4000`, `TRIMESH 0x4100`, `VERTLIST 0x4110`, `FACELIST 0x4120`, `MAPLIST 0x4140`, `SMOOLIST 0x4150` (`:20-27`) con `fread` directo de `unsigned short/int/float` (`:113-129`, asume little-endian y tamaños de tipo). Calcula normales por vértice respetando smoothing groups (`:251-355`) y aplana todo a un array lineal de triángulos con **8 floats por vértice: posición, normal, UV** (`load3ds.h:14-19`; `create_mesh`, `:357-386`). Ignora materiales, jerarquía, keyframes y colores. Usa `<malloc.h>` (`:15`). Se incluye como fuente dentro de `Model.cc` (`#include "load3ds.c"`, `Model.cc:9`).
- **`Model`** (`Graphics/include/Model.h:24-120`): `puntos` (float*), `n_vertices`, `id` de display list, `ruta`, `color`, `Textura*`, `Material`. `createDisplayList()` (`Model.cc:176-235`): si `id == -1` reserva **1000 nombres** con `glGenLists(1000)` (`:180`); compila `GL_TRIANGLES` con `glNormal3fv/glTexCoord2fv/glVertex3fv` sobre el array de 8 floats (`:211-218`). `createDisplayList(int)` (`:239-277`) además hornea `glTranslated(0,0,-10); glScaled(20,20,20); glRotated(-90,1,0,0); glRotated(90,0,1,0)` (`:258-261`). `exportOpenGL()` → `glCallList(id)` (`:280-286`). Bug: el constructor de copia y `operator=` copian `n_vertices` floats cuando el buffer tiene `n_vertices*8` (`Model.cc:72-77,100-105`). 
- Animación de personajes por *frames de malla*: `ResourceManager` carga 5 modelos por tipo de entidad con id `tipo*5 + k` (`core/lib/ResourceManager.cc:568-686`) y `EntityManager` rota `idDisplay` entre ellos al caminar (`core/entities/lib/EntityManager.cc:663-671`). Los ficheros `Graphics/Resources/modelos/{c,d,e,h,m,p,s,sn,sp}{1..5}.3ds` son esos frames. Formato `.3ds`: 75 ficheros.

### 1.6 Formas, primitivas y texto

- **`MotorGrafico.h/.cc`**: funciones libres en modo inmediato: `DrawCircle`, `DrawSolidCircle`, `DrawPolygon`, `DrawSolidPolygon`, `DrawLine`, `DrawPoint`, `DrawText` (×2, GLUT), `DrawTriangle` (`MotorGrafico.h:22-38`). Constantes `TXC = 200` segmentos, `GRADOS = 360` (`:19-20`).
- **`Shape`** (`Graphics/include/Shape.h:27-100`): polígono/línea/cadena/quad texturizado. `exportOpenGL()` (`Shape.cc:168-240`): la variante texturizada usa siempre la textura `t_explosion` del `ResourceManager` (`:184`) y `GL_QUADS` con `glColor4d(1,1,1,0.8)` (`:188-209`) — es el *sprite* de explosión; la cadena usa `DrawLine`; el resto `DrawPolygon/DrawSolidPolygon`.
- **`Text`** (`Graphics/include/Text.h:38-172`): envuelve un `FTGLTextureFont*` obtenido de `ResourceManager::getFont(fuente, size)` (`Text.cc:51,67,80`). `exportOpenGL()`: `glTranslatef(pos)`, `glColor4f`, `glScalef(1,-1,1)`, `font->Render(cadena.c_str())` (`Text.cc:132-144`). Fuentes `Graphics::Font::Name {Monospace, Serif, SansSerif, BebasNeue, Coolvetica, Absender, tf2, tf2Build}` (`GraphicsNamespace.h:134-147`) ↔ `Graphics/Resources/fuentes/*.ttf`.

### 1.7 Animación

- **`Animation`** (`Graphics/include/Animation.h:22-266`): anima una `Entity` (traslación por deltas, rotación 2D, fundido de color) o una `Transform` (traslación, rotación XYZ) por tiempo con `Clock` del core (`Animation.cc:101-270`). Avanza de segmento cuando `(int)porcentaje == 1` (`:124,199,263`). `play()` es un bucle ocupado (`:97-99`). Comentario propio: "Las entity solo funcionan en 2 dimensiones" (`Animation.h:20`).
- **`AnimationControl`** (singleton, `Graphics/include/AnimationControl.h:19-167`): `slideUp/Down/Left/Right` entre menús con **su propio bucle de render bloqueante** (`AnimationControl.cc:147-198`: `while(!terminado){ sm->clean(); …; gameMenu->Render(); window->display(); }`) y desplazamientos hard-coded 800/600 (`:200-216`); `addFadeIn/addFadeOut/addRotationInfinite` (`:70-108`, hace `((Object*)ent)->myAnimation = anim`), `Update()` elimina las finitas terminadas y reinicia las infinitas (`:110-128`). Depende del core (`TWindow`, `GameMenu`, `Object`).

### 1.8 Convención de coordenadas

Mundo 2D en píxeles con **Y hacia abajo** (coordenadas de pantalla). Para pintar en OpenGL se invierte con `addScale(1,-1,1)` en múltiples sitios (`SceneManager.cc:736`, `:909`, `:997`; `Text.cc:139`; `core/lib/GameAction.cc:778,784`). La escena 3D se inclina con `addRotationX(angleCamera)` (por defecto −30°, `core/lib/GameAction.cc:273,775`; ajustable ±1° desde `core/lib/HIDControl.cc:233-235`) y se aleja con `addTranslation(0,0,zoom)` (`GameAction.cc:774`).

Volumen: `Graphics/include` + `Graphics/lib` = 8.665 líneas; `lib` = 5.876 (`wc -l`).

---

## 2. Motor físico

### 2.1 Qué se abstrae sobre Box2D

Box2D **2.2.1** vendorizado (`3rdParty/Box2D/Box2D/Common/b2Settings.cpp:24`: `b2_version = {2, 2, 1}`; el `3rdParty/Box2D/CMakeLists.txt:12` declara erróneamente `BOX2D_VERSION 2.1.0`). Las 46 cabeceras están **duplicadas literalmente** en `Physics/include/Box2D/` (0 diferencias con `diff -rq`), sin `.cpp`.

| Clase propia | Qué envuelve | Puntos clave |
|---|---|---|
| `World` (`Physics/include/World.h:57-135`) | `b2World*` | Gravedad por defecto `Force(0,0)` (`World.h:62,67`; `World.cc:12-23`); `SetAllowSleeping(doSleep)`. `UpdateWorld()` toma los FPS de `Aplication::getInstance()->getFps()` y hace `world->Step(1.0/fps, 8, 3)` (`World.cc:52-61`) → **paso de tiempo variable**, 8 iteraciones de velocidad y 3 de posición. `World.cc:10` incluye `Aplication.h` del core (dependencia invertida). El constructor de copia copia el puntero (`World.cc:34-45`, comentario "no se puede tener más de un mundo") → riesgo de doble `delete`. |
| `Body` (`Physics/include/Body.h:22-102`) | `b2Body*` + `BodyData*` + `World*` | Creación: `CreateBody + CreateFixture + SetMassData + SetFixedRotation(false)` (`Body.cc:10-18`). El destructor **solo destruye la fixture, nunca el `b2Body`** (`Body.cc:41-46`, `DestroyBody` comentado) → los cuerpos se acumulan en el mundo. `setAngle` grados→radianes con cambio de signo (`radian = -1*angle*M_PI/180`, `:126`) mientras `getAngle` devuelve grados sin invertir (`:130-137`). `getPosition()` fuerza `z = 1` (`:109`). `TestPoint` (`:153-163`), `solidContacts` (`:165-193`, solo el primer `b2ContactEdge`), `contact(Body&)` (`:195-265`), `applyImpulse` usa `cos/sin(f.Angle())` → **vector unitario, ignora la magnitud** (`:272-282`). |
| `BodyData` (`Physics/include/BodyData.h:17-117`) | `b2BodyDef*`, `b2FixtureDef`, `b2MassData*`, `Box*`, `Polygon` | Construido desde un `Polygon`: posición = centroide del polígono (`BodyData.cc:26-32`), `density 1.0` (`:37`), masa por parámetro (`:24`). Setters con validación (`friction` en [0,1], `:150-155`; `restitution`, `:158-163`; damping, sensor, awake, ángulo). **Filtros de colisión** (ver 2.3). |
| `Box` (`Physics/include/Box.h:34-116`) | `b2Shape*` | Fábrica de formas según `Polygon::getType()`: `POL_EDGE → b2EdgeShape`, `POL_CIRCLE → b2CircleShape`, `POL_POLYGON → b2PolygonShape::Set` (máx. 8 vértices, `b2Settings.h:53`), `POL_CHAIN → b2ChainShape::CreateLoop` (`Box.cc:129-168`). Usa VLAs `b2Vec2 vector[n_vertex]` (`Box.cc:13,38,80,94,133`, extensión GCC). Conversores `Point2b2Vec2`/`b2Vec22Point` (`Box.cc:205-235`). |
| `Force` (`Physics/include/Force.h:15-74`) | `b2Vec2` | Vector 2D (x,y) con getters/setters; se usa tanto para gravedad como para velocidades. |

### 2.2 3D vs 2D: cómo lo resuelven

**Es física estrictamente 2D con render 3D ("2.5D" top-down).** La simulación vive en el plano XY en píxeles; la Z no existe para Box2D.

1. Cada `Entity` toma su posición del cuerpo: `Entity::getCenter()` devuelve `body->getPosition()` (x,y del `b2Body`) conservando su propia Z (`core/entities/lib/Entity.cc:96-105`); `getAngle()` devuelve `body->getAngle()` (`:107-110`).
2. Cada frame `EntityManager` copia pose física → `Transform` padre del nodo gráfico: `setIdentity(); addTranslation(pos); addRotationZ(angle)` (`core/entities/lib/EntityManager.cc:804-810, 918-924, 943-949, 963-968`). El nodo gráfico de la entidad es una display list del modelo 3DS (`GraphicTree.cc:603,622`).
3. La raíz `t_escena` inclina todo el plano: `addTranslation(0,0,zoom); addRotationX(angleCamera=-30°); addRotationZ(angleAction); addTranslation(-x, y, -100); addScale(1,-1,1)` (`core/lib/GameAction.cc:772-779`) y la cámara `c_escena` es perspectiva 45° (`SceneManager.cc:652-654`).
4. Las paredes/suelos/puertas son cuerpos estáticos `setNeutral()` creados a partir de sus polígonos 2D (`core/entities/lib/Wall.cc:68-71`, `Floor.cc:65-68`, `Door.cc:55-58`); su geometría 3D (alzado de paredes, techos) se genera en display lists por `ResourceManager` con las texturas `t_wall*`/`t_door*` (`core/lib/ResourceManager.cc:176-538`).

### 2.3 Escalas, gravedad y filtros

- **Escala:** no hay conversión píxel↔metro en ningún sitio. Las coordenadas físicas son píxeles de una ventana 800×600 (p. ej. widgets en `Point(400,200)`, `core/src/testRadioB.cc:285`; HUD en (710,580), `SceneManager.cc:726`). Box2D está afinado para metros y **no modificaron `b2Settings.h`** (idéntico a la copia): `b2_linearSlop 0.005` (`3rdParty/Box2D/Box2D/Common/b2Settings.h:67`), `b2_velocityThreshold 1.0` (`:89`), `b2_maxTranslation 2.0` unidades por paso (`:101`) → **desplazamiento máximo de 2 px por `Step`, es decir ~120 px/s a 60 FPS**. Funciona porque se fija la velocidad directamente cada frame (`Entity::setLinearVelocity`, `core/entities/lib/Player.cc:173`, `Bot.cc:381`) con `setMaxForce(4)` (`Player.cc:30`) y `linearDamping 5` (`core/lib/ModelPhisic.cc:17`, `Obstacle.cc:85`).
- **Gravedad:** cero (`new World()` en `core/lib/GameAction.cc:15,91` → `Force(0,0)`). Vista cenital; nada cae.
- **Filtros (`BodyData.cc:198-225`):**

  | Método | `categoryBits` | `maskBits` | Colisiona con | Quién lo usa |
  |---|---|---|---|---|
  | `setNeutral()` | 0x0001 | 0x000E | good, bad, obstacle (no neutral) | paredes, suelos, puertas (`Wall.cc:69`, `Floor.cc:67`, `Door.cc:56`) |
  | `setGoodPerson()` | 0x0002 | 0x000D | neutral, bad, obstacle (no good) | jugador y aliados (`core/lib/ModelPhisic.cc:19-46`) |
  | `setBadPerson()` | 0x0004 | 0x000B | neutral, good, obstacle (no bad) | enemigos (`ModelPhisic.cc:55-91`) |
  | `setObstacle()` | 0x0008 | 0x0007 | neutral, good, bad (no obstacle) | obstáculos y objetos (`Obstacle.cc:87`; `Object.cc:125-126` además `setSensor(true)`) |

  Los aliados no chocan entre sí, los enemigos tampoco entre sí, y **todos los raycasts ignoran las fixtures con `categoryBits == 0x0008`** (`World.h:168-171, 224-227, 309-310`) → los obstáculos no bloquean la línea de visión ni el láser.

### 2.4 Para qué se usa la física además de colisiones

Sí: la física es el **motor geométrico de propósito general** del juego.

- **Raycast de visión / línea de tiro.** `World::RayBody(p1,p2)` devuelve `RayData {body, point, centro, normal, hit}` (`World.h:22-34`, `World.cc:131-168`). Lo usan: el láser del jugador hacia el ratón (`core/entities/lib/Character.cc:405`), la visión de los bots (`Bot.cc:302,443`: `RayBody(...).body == objetivo->getBody()->getBody()`) y las explosiones para decidir a quién empujan (`EventControl.cc:199,242`). `World::canSee(Body*,Body*)` (`World.cc:170-194`) y `World::Ray()` (visibilidad booleana, `:63-81`) completan el API.
- **Construcción del grafo de navegación (intersección de triángulos con paredes).** `Map.cc` lanza rayos por cada arista de cada triángulo de la Delaunay (`CutOffPoints(A,B)`, `core/lib/Map.cc:697-699`) para descartar triángulos que cruzan muros; comprueba si un punto está dentro del mapa por **paridad de cortes** de un rayo hacia `(-99999,-99999)` (`Map.cc:747,987,1064`; `AI/lib/Pathfinder.cc:198`); decide la conectividad entre triángulos vecinos con `CutOffPoints(incentro, incentro_vecino).empty()` (`Map.cc:863-873`); y usa `Body::contact()` — que lanza `MultiRayBody` por cada arista de una `b2ChainShape` (`Body.cc:195-265`) — para hallar puntos de corte entre cadenas de paredes (`Map.cc:904,942`). `Pathfinder.cc:207` poda aristas del grafo con `World::Ray`.
- **Hit-testing de la UI.** Cada widget crea un cuerpo estático con su rectángulo (`core/lib/TButton.cc:103-104`, `TCheckBox.cc:82-83`, `TPicture.cc:137-138`, `TRadioButton.cc:29-30`) y el formulario detecta clics con `Body::TestPoint` (`core/lib/TForm.cc:291,301`, `TRadioButton.cc:43`); `TForm::Draw` incluso hace `world->UpdateWorld()` (`TForm.cc:357`). Recogida de objetos por `TestPoint` (`EntityManager.cc:649`).
- **Callbacks** (`World.h:141-376`): `BodyRayCastCallback`, `MultiBodyRayCastCallback` (hasta 1000 impactos), `RayCastMultipleCallback` y `RayCastClosestCallback` (estos dos copiados del testbed de Box2D, con su cabecera de licencia en `World.h:256-272`). Bug: `MultiRayBody` accede a `m_points[m_count-1]` aunque `m_count == 0` (`World.cc:227`).

### 2.5 Programa de prueba

`Physics/src/test.cc` (dos polígonos dinámicos, dibuja contactos) **no se compila**: `Physics/CMakeLists.txt:5` tiene `add_subdirectory(src)` comentado y su `CMakeLists.txt` referencia rutas y targets inexistentes (`../../box2d/86`, `Stra2DGraphics`, `StraBase`, `Physics/src/CMakeLists.txt:7-8,21`).

---

## 3. Motor de sonido

Envoltorio fino sobre **SFML Audio 2.0 (snapshot 2011)**, que a su vez usa OpenAL + libsndfile (`3rdParty/SFML/src/SFML/Audio/CMakeLists.txt:41-42`).

### 3.1 Enumerados (`sound/include/SoundNamespace.h`)

```
Audio::MAX_SOUNDS = 20            (:12)   Audio::MAX_SOUNDS_STEPS = 20  (:17)
Audio::Music::Status { s_stopped, s_playing, s_paused }            (:19-23)
Audio::Music::Song   { s_menu, s_action, s_credits }               (:24-28)
Audio::Sound::Status { s_stopped, s_playing, s_paused }            (:31-36)
Audio::Sound::Effect { e_pistol, e_explosion, e_machineGun, e_knife, e_step, e_dead, e_ouch, size }  (:37-46)
```

`Audio::Music::Song` se traduce a rutas en `AudioControl::switchSong` (`sound/lib/AudioControl.cc:140-162`): `s_menu → testFiles/sound/LegendsOfLiberty.ogg`, `s_action → testFiles/sound/andorga.ogg`, `s_credits → testFiles/sound/credits.ogg` (rutas relativas al directorio de ejecución). Lo invoca `core/lib/Aplication.cc:142-368`.

### 3.2 Clases

- **`AudioControl`** (singleton, `sound/include/AudioControl.h:27-148`): una `TMusic` en bucle (`AudioControl.cc:41-42`); siete `TSoundBuffer` cargados en el constructor desde `testFiles/sound/personal/` o, si existe `testFiles/sound/joke.txt`, desde `testFiles/sound/joke/` (`:47-63`, ficheros `pistol/explosion/machine/knife/step/dead/ouch.ogg`), indexados por `Audio::Sound::Effect`; **dos anillos de 20 voces** (`TSound sounds[20]`, `steps[20]`, `AudioControl.h:129,137`) con cursores `iter_sounds/iter_steps` — la voz siguiente se detiene y se reasigna (`AudioControl.cc:78-123`), separando pasos del resto "para no cortar sonidos con tantos pasos" (`AudioControl.h:132-133`). `playSound(Effect)` no espacial (`setRelativeToListener(true)`, `:78-92`); `playSound(Effect, Point)` espacial (`:94-109`); la explosión fuerza `attenuation 5` y `minDistance 600` (`:83-87,100-104`); los pasos `minDistance 500` y **`attenuation 50000`** (`:116-117`). `playSound(string)` carga, reproduce y **espera con bucle ocupado** (`:68-76`). `loadData()` lee volúmenes de `GameOptions` (`:34-38`) → dependencia del core (`AudioControl.h:15`).
- **`TSound`** (`sound/include/TSound.h:26-166`): envuelve `sf::Sound`; por defecto volumen 100, atenuación 20, `minDistance 300` (`TSound.cc:10-20`); posición 3D `SetPosition(x,y,z)` (`:48-50`); loop, pausa, estado. El destructor pone volumen 0 (`:36-38`) como parche a que destruir una copia para el sonido. `getStatus()` imprime "Stoped" y una cadena basura por `cout` (`:116,119`).
- **`TMusic`** (`sound/include/TMusic.h:21-85`): envuelve `sf::Music` (streaming desde disco): `OpenFile`, `setVolume`, `setLoop`, `Play/Pause/Stop`, `GetStatus` (`TMusic.cc`).
- **`TSoundBuffer`** (`sound/include/TSoundBuffer.h:20-74`): envuelve `sf::SoundBuffer*` (`LoadFromFile`); copia profunda en el constructor de copia; `operator=` **pierde el buffer anterior** (`TSoundBuffer.cc:35-40`).
- **`TListener`** (`sound/include/TListener.h:19-52`): estático sobre `sf::Listener::SetPosition/SetGlobalVolume` (`TListener.cc`). El juego coloca el oyente en el jugador cada frame (`core/lib/GameAction.cc:765`).

### 3.3 Espacialización y canales

Espacialización 3D de OpenAL vía SFML con **coordenadas en píxeles** (de ahí `minDistance` de 300–600 y atenuaciones enormes); el oyente no tiene orientación configurada (SFML por defecto mira a −Z), de modo que la panorámica izquierda/derecha sale del eje X de pantalla. No hay concepto de canal/bus ni mezcla: solo los dos anillos de voces y el volumen global de `TListener`. Tests: `sound/src/testBlank.cc` (SFML directo), `testAbstraction.cc` (wrappers), `testSpacialization.cc` (ejemplo de SFML). Assets: `testFiles/sound/*.ogg` (~15 MB, `ls`).

---

## 4. Partículas

### 4.1 Librería `WankelParticles` (`3rdParty/WankelParticles/`)

Librería externa bajo **GPLv3** (`3rdParty/WankelParticles/readme:1-2`), autor "sempere" (`include/texture.hpp:4`), con **SOIL** (Jonathan Dummer, 2007, `soil/SOIL.h`) y `stb_image` embebidos para cargar texturas. Modo inmediato OpenGL.

- `Particle` abstracta (`include/particle.hpp:10-20`) y cuatro partículas monolíticas antiguas (`RandomColorPVAParticle`, `ColorPVAParticle`, `ColorPVDParticle`, `ColorSinParticle`, `:22-138`) más `Emitter` clásico (`include/emitter.hpp`). **El juego no usa estas; usa la variante compuesta.**
- `CompositeParticle` = `lifeTime` + `ParticleMover*` + `ParticleRenderer*` (`include/compositeParticle.hpp:54-75`); `isDead()` ⇔ `lifeTime < 0 && lifeTime > -9999` (`:63`). `render()`: el mover hace `glPushMatrix; glTranslatef; glRotatef×3; glScalef(2,2,2)` (`lib/compositeParticle.cpp:33-42`), opcionalmente *billboarding* anulando la rotación de la modelview (`:65-87`, desactivado por defecto), `glDisable(GL_TEXTURE_2D)` y el renderer dibuja un `GL_QUADS` de −1..1 con `glNormal3f(0,0,1)` y hace el `glPopMatrix` (`:606-620`).
- **Movers:** `ParticleMoverPVA` (posición/velocidad/aceleración, `:95-142`), `PVD` (deceleración), `Sin` (oscilación), `Forces` y `ForcesInertia` (puntos de atracción globales/locales, `:269-569`).
- **Renderers:** `ColorFading` (`:575-633`), `ColorUA` (color con velocidad/aceleración), `SecuentialColorFading`, `TextureFading` (texturas SOIL), `ColorTracer` y `ColorTracerConstantLength` (estela `GL_LINE_STRIP` de las últimas 20 posiciones, `:967,1041`).
- **`CompositeEmitter<Mover, Renderer>`** (`include/compositeEmitter.hpp:14-93`): configuración por **mapa de claves de texto** `setMinMaxValues("clave", min, max)`; las claves las declaran `getRequiredValues()` de cada mover/renderer: `positionX/Y/Z`, `speedX/Y/Z`, `accelX/Y/Z`, `lifeTime`, `colorR/G/B/A`, `fade`, `amplitude`, `round`, `textureNum`, `decel`, `mass`, `colorV*`, `colorA*`. `getParticle()` muestrea uniforme con `random() % (precision+1) / precision` (precisión 100, `:83`) pero **la vida usa solo `minValues["lifeTime"]`** (`:88`, el máximo se ignora). `setPrecision` contiene `this.precision` (`:33`, no compilaría si se instanciara). `ParticleStorage`/`myVector` (`include/particleStorage.hpp`, `include/myVector.hpp`) no se usan en el juego; `myVector::clear()` referencia una variable inexistente (`myVector.hpp:48`).
- Demo `src/main.cc` con freeglut (fuego, humo, arcoíris, fuerzas, inercia) — no se compila (no hay `src/CMakeLists.txt`).

### 4.2 Integración en el juego

- **`ParticleNode : Element`** (`core/include/ParticleNode.h:14-28`): adaptador que cuelga una `CompositeParticle*` del grafo de escena con tipo `Core::Element::e_particle` (`core/lib/ParticleNode.cc:11,31`) y `Render()` → `wParticle->render()`. Lo dibuja `GraphicTree::Render` (`Graphics/lib/GraphicTree.cc:657-658`); `GraphicNode::Render` **no tiene el caso** (`GraphicTree.cc:731-813`).
- **`ParticleManager`** (singleton, `core/include/ParticleManager.h:53-104`): dos efectos, `Graphics::Particle::Type {explosion, bloodBurst}` (`Graphics/include/GraphicsNamespace.h:181-188`), con tres emisores:

  | Emisor | Tipos | Configuración (`core/lib/ParticleManager.cc:158-213`) |
  |---|---|---|
  | `debris` (explosión) | `CompositeEmitter<ParticleMoverPVA, ParticleRendererColorFading>` | vida 0.5–0.75 s; z=5; velocidad XY ±250 px/s, Z 0–50; aceleración XY ±150, Z 0–50; color gris-arena (0.72, 0.69, 0.64) con fade |
  | `bloodT` (sangre, estela) | `CompositeEmitter<ParticleMoverPVA, ParticleRendererColorTracerConstantLength>` | vida 0.5–0.75 s; z=50; velocidad Z −10..0; aceleración XY ±100; rojo puro con fade |
  | `bloodQ` (sangre, quads) | `CompositeEmitter<ParticleMoverPVA, ParticleRendererColorFading>` | igual que `bloodT` pero aceleración XY ±20 |

  `doExplosion(p)` / `doBloodBurst(p, dir)` (`ParticleManager.cc:22-34`) encolan un `AuxPart` si `GameOptions::isParticlesOn()`; la sangre desplaza el origen 30 px hacia atrás en la dirección del impacto (`ParticleManager.h:33-42`). `Update()` (`:36-134`): dt en segundos con `Clock`; hace `step(dt)` a cada partícula, borra las muertas y las quita del árbol (`sm->removeElement`, búsqueda lineal); cada emisor vive **100 ms** (`:68,92`) y **cada frame** genera 100 partículas de escombros (`:79`) o 10+10 de sangre (`:110`), todas insertadas como nodos hijos de `t_escena` (`:83,114,119`) → a 60 FPS ≈ 600 nodos por explosión, con inserción y borrado O(n) en el árbol. La velocidad de la sangre se fija como `dir/2 ± 10` (`:101-107`). La carga de texturas está comentada (`:215-219`), por lo que `textureNum` (`:177`) no tiene efecto. Se invoca desde `EventControl` (`core/entities/include/EventControl.h:18`).
- Resultado visual: cuadrados planos de 4 px (escala 2, sin billboard) iluminados por el pipeline fijo (normal (0,0,1)), con blend activo durante la pasada de escena (`SceneManager.cc:152`).

---

## 5. Dependencias de terceros

| Librería | Versión (fuente) | Para qué se usa | Licencia | ¿Equivalente nativo en Godot 4? | Veredicto |
|---|---|---|---|---|---|
| **SFML** | 2.0 *snapshot* pre-release (`3rdParty/SFML/include/SFML/Config.hpp:32-33`; © 2007-2011; API PascalCase `LoadFromFile`, `GetPixelsPtr`, `SetVolume`, `Sleep(Uint32)` — `Image.hpp:97,250`, `SoundSource.hpp:97`, `System/Sleep.hpp:46`) | Ventana y contexto GL (`sf::RenderWindow`), entrada, reloj, carga de imágenes para texturas (`Textura.cc:78`), compilación de shaders (`sf::Shader`, `ResourceManager.cc:55-85`), **todo el audio** (`sf::Sound/Music/SoundBuffer/Listener`) | zlib/libpng (`3rdParty/SFML/license.txt`) | Sí: `DisplayServer`/`Window`, `Input`, `Image`/`Texture2D`, `Shader`, `AudioStreamPlayer{,2D,3D}`, `AudioStreamOggVorbis`, `AudioListener3D` | **DESCARTAR** |
| **Box2D** | 2.2.1 (`3rdParty/Box2D/Box2D/Common/b2Settings.cpp:24`; CMake dice 2.1.0) | Cuerpos, fixtures, filtros, raycast, `TestPoint`, contactos | zlib (`3rdParty/Box2D/License.txt`) | Sí: `RigidBody2D`/`StaticBody2D`/`CharacterBody2D`, `CollisionPolygon2D`, `collision_layer/mask`, `PhysicsDirectSpaceState2D.intersect_ray/intersect_point`, `Area2D` (sensor) | **DESCARTAR** |
| **FTGL** | 2.1.3~rc5 (`3rdParty/FTGL/config.h:77`) | Texto con `FTGLTextureFont` (`Text.h:74,153`; `ResourceManager.h:20`) sobre FreeType | MIT/Expat (`3rdParty/FTGL/FTGL/ftgl.h:8-26`) | Sí: `Label`, `RichTextLabel`, `Label3D`, `FontFile` (.ttf) | **DESCARTAR** |
| **GPC** (General Polygon Clipper) | 2.32, 17/12/2004 (`3rdParty/GPC/gpc.h:9-11,49`) | Operaciones booleanas de polígonos en `Math/lib/Polygon.cc:301-332` (`toGPC/fromGPC`); llega a mi ámbito transitivamente vía `Polygon.h` (`Physics/include/Box.h:17`, `World.h:16`, `Graphics/include/MotorGrafico.h:13`, `Shape.h:14`) | **Solo uso no comercial**, © Advanced Interfaces Group, Univ. Manchester (`gpc.h:16-25`: "You may not use this software … in support of any commercial product without the express consent of the author") | Sí: `Geometry2D.merge_polygons/clip_polygons/intersect_polygons/exclude_polygons` (Clipper2) | **DESCARTAR** (riesgo legal) |
| **tinyXML** | 2.6.2 (`3rdParty/tinyXML/tinyxml.h:92-94`) | Carga de mapas/entidades/opciones XML (`editorMap.xml`, `testFiles/entities.xml`; enlazado en `StraCore`/`StraEnt`) | zlib (`tinyxml.h:1-23`) | Sí: `XMLParser`; o mejor JSON (`JSON`), `ConfigFile`, recursos `.tres` | **DESCARTAR** |
| **WankelParticles** (+ SOIL + stb_image) | sin versión; "v1.0" en `src/main.cc:198` | Sistema de partículas (explosión, sangre) vía `ParticleManager` | **GPLv3** (`3rdParty/WankelParticles/readme:1-2`); SOIL/stb_image de dominio público según sus autores (el árbol no incluye texto de licencia de SOIL) | Sí: `GPUParticles3D`/`CPUParticles3D` + `ParticleProcessMaterial` (o `GPUParticles2D`) | **DESCARTAR** (copyleft incompatible con cualquier licencia no-GPL del port) |
| **load3ds.c / loadjpeg.h** (A. Zaprjagaev) | s/v (`Graphics/lib/load3ds.c:1-6`) | Carga de mallas `.3ds` | Sin licencia declarada | **No**: Godot 4 no importa `.3ds`; los 75 modelos deben convertirse a glTF/OBJ (p. ej. con Blender) | **DESCARTAR** (convertir assets) |
| Sistema (no vendorizadas) | — | OpenGL fixed-function, GLU, GLUT/freeglut, GLEW (SFML), FreeType, libjpeg, OpenAL, libsndfile, X11/Xrandr (`installer.sh:12`; `3rdParty/SFML/src/SFML/Graphics/CMakeLists.txt:77-85`; `Audio/CMakeLists.txt:41-42`) | varias | Cubierto por el runtime de Godot | **DESCARTAR** |

---

## 6. Sistema de build

### 6.1 Qué hace el CMake raíz (`CMakeLists.txt`)

- `cmake_minimum_required(VERSION 2.6)` (`:4`); **no hay `project()`** en el nivel superior (los subdirectorios sí: `StraGraphics`, `StraSound`, `Stracomter`, `StraEnt`, `StraMath`, `WankelParticles`, `SFML`).
- **Flags:** `set(BOX2D ON)` (`:11`) — si ON hace `add_subdirectory(3rdParty/Box2D)` (`:42-44`); pero el include dir se añade igual (`:59`) y `StraPhysics` enlaza el target `Box2D` incondicionalmente (`Physics/lib/CMakeLists.txt:7`), así que OFF solo funcionaría con un Box2D instalado con ese mismo nombre de target/librería. `set(TEST_DEBUG ON)` (`:14`) — **no se lee en ningún otro fichero** (grep en todo el trunk: única aparición). Es un flag muerto.
- Detección: `find_package(OpenGL REQUIRED)`, `find_package(Freetype REQUIRED)`, `find_package(GLUT)` (`:21-26`); `find_package(SFML)` está comentado (`:29`) y la SFML se compila en árbol (`:35-39`). `${PROJECT_BIN_DIR}` (`:37`) es una variable inexistente (debería ser `PROJECT_BINARY_DIR`). Los módulos `cmake_modules/FindSFML.cmake` y `FindGLEW.cmake` **nunca se añaden a `CMAKE_MODULE_PATH`** (grep: solo la SFML fija el suyo) → código muerto.
- `add_definitions(-DRESOURCESROOT="${CMAKE_CURRENT_SOURCE_DIR}/Graphics/Resources/")` (`:101`) hornea una **ruta absoluta de la máquina de compilación** en los binarios; `add_definitions(-Wall -g)` siempre (`:103`), sin configuración Release ni `-O`.
- Orden: 3rdParty (SFML, Box2D, GPC, FTGL, tinyXML, WankelParticles) → `core/entities`, `Math`, `Graphics`, `AI`, `Optimization`, `Physics`, `sound` → `core` (`:35-50,109-122`). Los `include_directories`/`link_directories` globales (`:56-95`) hacen que cualquier módulo vea cualquier cabecera, lo que oculta las dependencias circulares reales (Graphics→core, Physics→core, sound→core).

### 6.2 Targets reales

**Librerías (todas estáticas salvo indicación):** `StraMath` (+`GPC`), `StraGraphics` (`OPENGL`, SFML, `FTGL`, `StraMath`), `StraPhysics` (`StraMath`, `Box2D`), `StraAI` (`StraMath`, `StraPhysics`), `StraOptimization` (`StraMath`), `StraAudio` (SFML), `StraEnt` (`StraGraphics`, `StraAI`, `StraOptimization`, `TinyXML`, GLUT, `sfml-system`), `StraCore` (`StraGraphics`, `StraAI`, `StraOptimization`, `StraAudio`, `TinyXML`, GLUT, `sfml-system`, `WankelParticles`); terceros: `sfml-system/window/graphics/audio/network` (compartidas por defecto), `Box2D` (compartida por defecto, `3rdParty/Box2D/CMakeLists.txt:9`), `GPC`, `FTGL`, `TinyXML`, `WankelParticles`, `Soil`.

**Ejecutables que sí se generan** (leídos en los `src/CMakeLists.txt`):

| Directorio | Target | Fuente | Notas |
|---|---|---|---|
| `core/src` | `Stracomter` | `Stracomter.cc` | **El juego** (`Aplication::getInstance()->Launch()`, `core/src/Stracomter.cc:10-25`) |
| `core/src` | `Editor` | `mapEditor.cc` | Editor de mapas |
| `core/src` | `Movimiento` | `testMov.cc` | Test |
| `core/src` | `RadioB` | `testRadioB.cc` | Test de widgets |
| `Graphics/src` | `ModelLoader`, `TextureLoader`, `Loader`, `Animation` | `modelLoader.cc`, `textureLoader.cc`, `loader.cc`, `animation.cc` | Visores de `.3ds`/texturas/frames (`Graphics/src/CMakeLists.txt:1-11`) |
| `sound/src` | `blank`, `abstr`, `spa` | `testBlank.cc`, `testAbstraction.cc`, `testSpacialization.cc` | Tests de audio (`sound/src/CMakeLists.txt:3-10`) |

**Comentados / no generados:** `generic`, `anim`, `Menus`, `Shaders`, `TPB`, `tstatus` (`core/src/CMakeLists.txt:7-29`); todo `AI/src` (`AI/CMakeLists.txt:6`; definiría `FSMMaker`, `FSMViewer`), todo `Optimization/src` (`Optimization/CMakeLists.txt:5`; `Simplex`, `pruebaOpti`), todo `Physics/src` (`motorFisica`). `core/entities/src/CMakeLists.txt` está vacío.

### 6.3 Scripts

- **`construir.sh`** (`:1-52`): sin argumentos → `mkdir build; cd build; cmake ..`. `com [target]` → `make $2` en `build/`. `cln` → borra los subdirectorios de `build/` excepto `3rdParty` (conserva la SFML compilada). `reset` → `rm -Rf build/`. `Demo` → ejecuta `./build/core/src/Stracomter`. `Model` → `./build/Graphics/src/ModelLoader`. **Rotos:** `mathGraph` → `./build/core/maths/src/testGraph` (ruta inexistente), `AStar`/`Navigation`/`Triangulation` → `./build/AI/src/{testNiceGrafic,testPathfinder,testDelaunay}` (fuentes existen en `AI/src/` pero `AI/src` no se compila y su CMake ni siquiera define esos targets), `Simplex` → `./build/Optimization/src/Simplex` (no se compila). Hay que ejecutarlo desde `legacy/trunk/` porque el audio usa rutas relativas `testFiles/sound/…` (`sound/lib/AudioControl.cc:47-63,144-150`).
- **`installer.sh`** (`:1-22`): `BASE-UBU`/`BASE-ARCH` instalan `g++ cmake make`; `UBU` instala con `apt-get` `freeglut3 freeglut3-dev libglew1.5 libglew1.5-dev libglu1-mesa(-dev) libgl1-mesa-glx libgl1-mesa-dev libxrandr-dev libfreetype6-dev libjpeg8-dev libopenal-dev libsndfile1-dev libxmu-dev libxi-dev` y crea el enlace `/usr/include/freetype2/freetype → /usr/include/freetype` (`:12-13`, parche para que FTGL/SFML encuentren FreeType); `ARCH` usa `pacman -S` **con los nombres de paquete de Debian** (`:16`) → no funciona.
- `cuentaLineas.sh`: contador de LOC excluyendo `3rdParty`. `Graphics/dox.sh`, `Physics/dox.sh`, `sound/dox.sh`: generación Doxygen por módulo.

### 6.4 ¿Compilaría hoy? — No, en ninguna plataforma

**Linux (Ubuntu 24.04 / Fedora / Arch actuales): NO sin reescritura del build y parches.**
1. **CMake:** `cmake_minimum_required(VERSION 2.6)` (`CMakeLists.txt:4`) y `2.8` en la SFML (`3rdParty/SFML/CMakeLists.txt:2`). CMake 4.x eliminó la compatibilidad con versiones < 3.5 → error fatal en la configuración; CMake 3.27–3.31 lo acepta con aviso de obsolescencia. Además la ausencia de `project()` en la raíz.
2. **SFML vendorizada:** hay que compilar el snapshot 2011 (su API PascalCase no existe en ninguna SFML instalable: 2.0 final renombró a camelCase en 2013, SFML 3 rompió más). Ese snapshot exige GLEW, libjpeg, libsndfile, OpenAL, X11/Xrandr; `libsndfile` fue abandonada por SFML ≥ 2.2 pero sigue existiendo como paquete; el código de ventana X11 de 2011 compila con GCC moderno solo con avisos, pero **no está probado**.
3. **Paquetes:** `libglew1.5`, `libjpeg8-dev` (`installer.sh:12`) ya no existen (hoy `libglew-dev` 2.2, `libjpeg-turbo8-dev`).
4. **OpenGL fijo + GLU + GLUT:** disponibles en Linux vía Mesa (perfil de compatibilidad), `libGLU`, `freeglut`. Compilaría, pero solo con drivers que expongan un contexto de compatibilidad.
5. **C++ moderno:** el código es pre-C++11 (`NULL`, sin `override`); GCC ≥ 11 con `-std=gnu++17` por defecto lo acepta, con muchos avisos. Los VLAs de `Box.cc` son extensión GCC (ok en GCC/Clang).

**macOS: NO.**
- `#include <GL/glut.h>` no existe; en macOS es `<GLUT/glut.h>` (`Graphics/include/MotorGrafico.h:14`, `Scene.h:16`, `Shape.h:19`, `core/include/TWindow.h:14`, `Graphics/src/*.cc:3`).
- `#include <malloc.h>` no existe en macOS (`Graphics/lib/load3ds.c:15`).
- La SFML snapshot compila su backend OSX contra SDKs 10.5/10.6 con `CMAKE_OSX_ARCHITECTURES "i386;x86_64"` (`3rdParty/SFML/CMakeLists.txt:80-94`); i386 no es compilable en Xcode actual y los frameworks precompilados de `extlibs/libs-osx` son de 2011 (sin arm64).
- OpenGL está **deprecado desde macOS 10.14** y el perfil de compatibilidad está congelado en 2.1; GLUT también deprecado.

**Windows (MSVC o MinGW): NO.**
- `Camera.h:103,105` declara miembros `int near; int far;` — `<windows.h>` (arrastrado por `GL/gl.h`) define `near` y `far` como macros vacías → error de sintaxis.
- VLAs `b2Vec2 vector[n_vertex]` (`Physics/lib/Box.cc:13,38,80,94,133`) no existen en MSVC.
- `random()` (`3rdParty/WankelParticles/include/compositeEmitter.hpp:83`) no existe en la CRT de Windows; `M_PI` requiere `_USE_MATH_DEFINES` en MSVC (`MotorGrafico.cc:26`, `Body.cc:126`, `Transformacion.cc:74`).
- Los binarios `extlibs/libs-msvc` de la SFML snapshot son para VS2008/2010; GLUT no viene con Windows (freeglut aparte).

**APIs muertas (resumen concreto):**
- OpenGL *fixed-function* (eliminado del perfil core desde GL 3.2 y ausente en GLES/WebGL/Vulkan/Metal): `glBegin/glEnd` (92 sitios), `GL_QUADS`/`GL_POLYGON`, display lists (`glNewList/glCallList`), pila de matrices (`glMatrixMode/glPushMatrix/glLoadMatrixd`), `glLightfv/glMaterialfv/glColorMaterial`, `glTexGeni`, `glShadeModel`, `glClearIndex`.
- GLU (`gluPerspective`, `gluBuild2DMipmaps`; sin mantenimiento desde 2012) y GLUT (`glutBitmapCharacter`, `glutStrokeCharacter`, `glutInit`).
- GLSL 1.10 de compatibilidad: `gl_LightSource`, `gl_FrontMaterial`, `gl_FrontLightModelProduct`, `ftransform()`, `gl_TexCoord`, `varying`, `texture2D` (todos eliminados en GLSL ≥ 1.40 core).
- SFML 2.0-RC (`LoadFromFile`, `GetPixelsPtr`, `SetVolume`, `Sleep(Uint32)`, `sf::Shader::Bind/Unbind`, `event.Type`, `sf::Keyboard::Escape`) → renombrada en 2.0 final y rota de nuevo en SFML 3 (2024).
- Box2D 2.2.1 C++ (`b2World::RayCast` con callbacks, `b2ChainShape::CreateLoop`, `SetUserData(void*)`) → Box2D v3 (2024) es una API C completamente distinta.
- FTGL 2.1.3-rc5 (último release 2008), GPC 2.32 (2004), tinyXML 2.6.2 (sucedida por TinyXML-2), SOIL (sucedida por SOIL2/stb_image).

---

## 7. Equivalencias Godot 4.7

| Subsistema legacy | Clase/nodo Godot 4 equivalente | Notas de migración | Esfuerzo |
|---|---|---|---|
| `GraphicTree`/`GraphicNode`/`Element` (árbol propio + `switch` de render) | `SceneTree` + `Node3D` (jerarquía nativa); `Node.visible` | El árbol de Godot ya hace push/pop de transformaciones; los `directNodes` pasan a ser rutas de nodo/`@onready`/grupos. Desaparece el acoplamiento con `Entity`/`GameMenu`/`TForm`. | Bajo |
| `SceneManager` (tres árboles: juego, menú, editor; flags GL globales) | Escenas `.tscn` separadas (`game.tscn`, `menu.tscn`, `editor.tscn`) + `SceneTree.change_scene_to_file`; `Environment`/`WorldEnvironment`; `SubViewport` para minimapa | Las pasadas HUD/minimapa se sustituyen por `CanvasLayer` y un `SubViewport` con `Camera3D` ortogonal. Los flags `zbuffer/culling/smooth` ya no existen como estado global. | Medio |
| `Transform` (matriz 4×4 propia, grados, post-multiplicación) + `TransformStack` | `Transform3D`, `Basis`, `Node3D.position/rotation/scale` | Cuidado con el eje Y invertido (`addScale(1,-1,1)`): el mundo legacy es Y-abajo en píxeles; en Godot 3D es Y-arriba. Definir la convención XZ (suelo) una vez. | Bajo |
| `Camera` (orto/perspectiva vía `glOrtho`/`gluPerspective`, near 1/far 20000) | `Camera3D` (`projection`, `fov=45`, `near`, `far`, `size` para orto) | Inclinación −30° (`GameAction.cc:775`) → `Camera3D.rotation.x` sobre un pivote que sigue al jugador. | Bajo |
| `Light`/`LightManager` (8 luces fijas GL, spot mal configurado) | `OmniLight3D`, `SpotLight3D`, `DirectionalLight3D`, `WorldEnvironment.ambient_light` | Sin límite de 8 luces (Forward+/Mobile). Convertir colores amb/dif/esp a `light_color`/`light_energy`; el ambiente global a `Environment`. | Bajo |
| `Material` + `Color<T>` | `StandardMaterial3D` (`albedo_color`, `metallic`, `roughness`), `Color` | Especular/brillo → `roughness`/`metallic_specular`. `Color` de Godot ya es float RGBA. | Bajo |
| `Textura` (SFML + `gluBuild2DMipmaps`, NEAREST) | `Texture2D`/`ImageTexture`, `CompressedTexture2D`; importador de PNG/JPG/TGA | Filtro NEAREST → `texture_filter = NEAREST_MIPMAP` si se quiere conservar el look; el importador genera mipmaps. | Bajo |
| `Model` + `load3ds.c` (display lists, 5 frames por animación) | `MeshInstance3D` + `ArrayMesh`/`.glb`; `AnimationPlayer` o `MeshInstance3D.mesh` alternado; `MultiMeshInstance3D` para repetidos | **Godot 4 no importa `.3ds`**: convertir los 75 modelos con Blender a glTF (idealmente unir los frames `x1..x5` en una animación por *shape keys* o en un `AnimationPlayer` que conmute mallas). | Medio |
| Shaders GLSL 1.10 (`Phong`, `CellShading`, `Pruebas`) | `StandardMaterial3D` (Phong por defecto) o `ShaderMaterial` con Godot Shading Language | El Phong es el shading estándar de Godot; el *cel-shading* de 4 bandas (`CellShading.frag:20-34`) se reescribe como `shader_type spatial` con `light()` o con textura de rampa; alternativamente `StandardMaterial3D.diffuse_mode = DIFFUSE_TOON`. | Bajo |
| `Text` + FTGL + fuentes `.ttf` | `Label`, `RichTextLabel`, `Label3D`, `FontFile` | Importar los 8 `.ttf` de `Graphics/Resources/fuentes/` como `FontFile`. | Bajo |
| `MotorGrafico.h` (primitivas inmediatas, debug) | `ImmediateMesh`, `MeshInstance3D` con `SurfaceTool`, `Line2D`, `_draw()` en `CanvasItem`, `DebugDraw` | Solo para depuración (triangulación, conos de visión): `_draw()` en un `Node2D` superpuesto o `ImmediateMesh`. | Bajo |
| `Animation`/`AnimationControl` (slides bloqueantes, fades) | `Tween` (`create_tween().tween_property`), `AnimationPlayer` | Los slides con bucle de render propio se convierten en `Tween` no bloqueante con `await tween.finished`. | Bajo |
| `World`/`Body`/`BodyData`/`Box`/`Force` (Box2D 2.2.1 en píxeles, gravedad 0) | `PhysicsServer2D`, `CharacterBody2D`/`RigidBody2D`/`StaticBody2D`, `CollisionPolygon2D`/`CollisionShape2D`, `Area2D`, `collision_layer/mask`, `PhysicsDirectSpaceState2D.intersect_ray/intersect_point`, `RayCast2D` | Mantener la simulación 2D (decisión de diseño válida): el mundo lógico es `Node2D` y se proyecta a 3D (`Vector3(pos.x, 0, pos.y)`), o se usa física 3D con `axis_lock_linear_y`. Godot 2D funciona en píxeles sin el techo de `b2_maxTranslation`. Los 4 filtros → 4 capas. `RayData` → `Dictionary` de `intersect_ray`. | Medio |
| Física para navegación (paridad de cortes, `contact`, poda de aristas) | `NavigationRegion2D`/`NavigationPolygon` + `NavigationServer2D` (bake automático), `Geometry2D` | Sustituye toda la construcción manual del grafo triangulado (`Map.cc`, `Pathfinder.cc`) y elimina GPC. Los ray-tests de línea de visión siguen siendo `intersect_ray`. | Alto (rediseño de la IA de navegación, fuera de mi ámbito pero condicionado por la física) |
| Física para UI (cuerpos estáticos por widget + `TestPoint`) | `Control` (`Button`, `CheckBox`, `TextureRect`, `Panel`) con `gui_input`/`pressed` | Eliminar por completo la física de la UI. | Bajo |
| `AudioControl`/`TSound`/`TMusic`/`TSoundBuffer`/`TListener` (SFML Audio, dos anillos de 20 voces) | `AudioStreamPlayer` (música, `AudioStreamOggVorbis` con `loop`), `AudioStreamPlayer2D`/`3D` (efectos), `AudioStreamPlaybackPolyphonic` o `max_polyphony`, `AudioListener2D/3D`, `AudioServer` buses | Los `.ogg` se importan tal cual. `Audio::Music::Song` → `Dictionary` enum→`AudioStream`. Volúmenes de `GameOptions` → buses `Music`/`SFX` en dB. Atenuación en píxeles → `max_distance`/`attenuation` del player 2D. | Bajo |
| `ParticleManager`/`ParticleNode` + WankelParticles (600 nodos por explosión) | `GPUParticles3D` (o `CPUParticles3D`) + `ParticleProcessMaterial` (`direction`, `spread`, `initial_velocity_min/max`, `linear_accel`, `color`, `color_ramp`, `lifetime`, `one_shot`, `emitting`); `GPUParticles3D.emit_particle` / `restart()`; estela con `GPUParticlesAttractor`+`Trail` o `ribbon_trail` | Dos efectos preconfigurados como escenas: `explosion.tscn` (100–600 escombros, gris-arena, vida 0.5–0.75 s) y `blood.tscn` (rojo, dirección del impacto, trails). Explosión `one_shot=true`, `amount≈600`, `explosiveness≈1`. | Bajo |
| Build (CMake 2.6 + `construir.sh` + `installer.sh`) | Proyecto Godot (`project.godot`) + exportación (`export_presets.cfg`) | Desaparece el toolchain nativo; los tests `Graphics/src`, `sound/src` se reemplazan por escenas de prueba o GUT/gdUnit. | Bajo |

---

## 8. Puntos críticos

| Subsistema | Veredicto | Justificación | Riesgo |
|---|---|---|---|
| Grafo de escena propio (`GraphicTree`, `GraphicNode`, `Element`, `SceneManager`, `Scene`) | **DESCARTAR** | Reimplementa lo que Godot da nativo (árbol, visibilidad, push/pop de transformaciones). Está acoplado al core (`GraphicTree.h:17-25`) y tiene bugs de copia (`GraphicTree.cc:85-87`). Solo conviene **replicar la topología** (cámara escena/HUD/minimapa, 3 luces, `t_escena` inclinado) como escenas `.tscn`. | Bajo |
| `Transform`/`TransformStack`/`Camera`/`Color` | **DESCARTAR** | Utilidades matemáticas que `Transform3D`, `Camera3D` y `Color` cubren; el único conocimiento a preservar es la convención Y-abajo y la cámara −30°/45° FOV. | Bajo |
| Iluminación y materiales (`Light`, `LightManager`, `Material`) | **REDISEÑAR** | Valores útiles (ambiente 0.1, difusa 0.7, especular 0.3–0.9, brillo 64–100, posiciones z=700/100 y luz que sigue al jugador) pero implementación GL fija con errores (`GL_LINEAR`, `Light.cc:210`; `glColorMaterial` repetido, `Material.cc:128-133`). Traducir a `OmniLight3D`/`StandardMaterial3D` ajustando a PBR. | Bajo |
| Modelos `.3ds` + `load3ds.c` + animación por 5 mallas | **REDISEÑAR** | El formato no se importa en Godot 4; las 5 mallas por personaje deben convertirse a animación real (glTF con morph targets o `AnimationPlayer` de mallas). Los assets son el valor; el cargador no. Riesgo de pérdida de UVs/normales en la conversión si los `.3ds` están corruptos (varios pesan pocos KB). | Medio |
| Shaders (`Phong`, `CellShading`, `Pruebas`) | **REPLICAR** (solo el cel-shading) | Phong es el default de Godot; el cel-shading de 4 bandas (`CellShading.frag:20-34`) es un rasgo estético propio y trivial de portar a Godot Shading Language. `Pruebas` es un experimento (ignora la textura, `Pruebas.frag:40-41`). | Bajo |
| Texto (`Text` + FTGL) y fuentes | **DESCARTAR** (conservar los `.ttf`) | `Label`/`Label3D` con `FontFile`. Conservar la lista de fuentes y tamaños del HUD (Absender 30, `SceneManager.cc:706-713`). | Bajo |
| Física 2D sobre Box2D (`World`, `Body`, `BodyData`, `Box`, `Force`) | **REDISEÑAR** | La **decisión** "simulación 2D + render 3D con cámara inclinada" es correcta y debe mantenerse; la **implementación** no: unidades en píxeles contra un motor en metros (`b2_maxTranslation 2.0`), cuerpos nunca destruidos (`Body.cc:41-46`), paso de tiempo variable (`World.cc:55`), `applyImpulse` sin magnitud (`Body.cc:274-275`), copia superficial de `World`. Migrar a la física 2D de Godot preservando las 4 capas de colisión y su matriz de máscaras (`BodyData.cc:198-225`) y el comportamiento "los obstáculos no bloquean rayos" (`World.h:168-171`). | Medio |
| Raycasts de visión/láser/explosión | **REPLICAR** | Comportamiento de juego (líneas de visión de bots, láser al ratón, empuje de explosión con LOS) fácilmente reproducible con `intersect_ray`/`RayCast2D` y máscaras. | Bajo |
| Física como geometría de navegación (paridad de cortes, `contact`) y como hit-test de UI | **DESCARTAR** | Uso impropio del motor físico para lo que Godot resuelve con `NavigationServer2D`, `Geometry2D` y `Control`. Elimina además la dependencia de GPC. | Bajo |
| Audio (`AudioControl`, `TSound`, `TMusic`, `TSoundBuffer`, `TListener`) | **REPLICAR** (contrato) / **DESCARTAR** (código) | El contrato es pequeño y claro: 7 efectos, 3 canciones, música en bucle, efectos espaciales relativos al jugador, pool para pasos, volúmenes desde opciones. Se replica con `AudioStreamPlayer{,2D}` y buses; el código (bucles ocupados, `operator=` con fuga, destructores que silencian) no. Los `.ogg` se reutilizan si la licencia de las pistas lo permite (`LegendsOfLiberty.ogg`, `andorga.ogg`, `acdc.ogg`, `credits.ogg`: **origen no documentado en el repo**). | Bajo (código) / Medio (derechos de las pistas) |
| Partículas (`ParticleManager`, `ParticleNode`, WankelParticles) | **REDISEÑAR** | Efectos deseados bien definidos (escombros grises 0.5–0.75 s, sangre roja direccional con estela) pero implementación insostenible (600 nodos de árbol por explosión, quads sin billboard, GPLv3). Recrear con `GPUParticles3D` a partir de los parámetros de `ParticleManager.cc:158-213`. | Bajo (técnico) / **Alto si se copiara código** (licencia GPL) |
| GPC | **DESCARTAR** | Licencia solo no comercial (`gpc.h:16-25`): incompatible con distribución comercial y con la mayoría de licencias libres. `Geometry2D` lo sustituye. | **Alto (legal)** si se conservara |
| WankelParticles (GPLv3) | **DESCARTAR** | Cualquier port que reutilice su código quedaría bajo GPLv3. | **Alto (legal)** si se conservara |
| SFML / Box2D / FTGL / tinyXML | **DESCARTAR** | Sustituidas íntegramente por el runtime de Godot; además son versiones pre-release o abandonadas. | Bajo |
| Sistema de build (CMake 2.6, scripts) | **DESCARTAR** | No configura con CMake 4.x, flag `TEST_DEBUG` muerto, `cmake_modules` no usados, rutas absolutas horneadas, scripts que apuntan a binarios inexistentes, `installer.sh` con paquetes obsoletos y rama Arch rota. Nada reutilizable salvo la lista de targets como inventario. | Bajo |
