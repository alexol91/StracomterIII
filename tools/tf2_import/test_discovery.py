"""Prueba de la búsqueda de Steam y TF2 contra un árbol de mentira.

Es la parte que más fácil falla en silencio: casi nadie tiene los juegos en la
biblioteca principal, así que mirar solo ahí es la forma más común de decirle a
alguien que no tiene un juego que sí tiene.
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_tf2  # noqa: E402


def main() -> int:
    fallos = []
    with tempfile.TemporaryDirectory() as tmp:
        steam = os.path.join(tmp, "Steam")
        second = os.path.join(tmp, "Disco2")
        os.makedirs(os.path.join(steam, "steamapps"))
        tf = os.path.join(second, "steamapps", "common", "Team Fortress 2", "tf")
        os.makedirs(tf)
        with open(os.path.join(steam, "steamapps", "libraryfolders.vdf"), "w") as h:
            h.write('"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"%s"\n\t}\n}\n'
                    % second.replace("\\", "\\\\"))

        libraries = import_tf2.steam_libraries(steam)
        if second not in libraries:
            fallos.append("no lee libraryfolders.vdf: se perdería la segunda biblioteca")
        found = import_tf2.find_tf2(steam)
        if os.path.normpath(found) != os.path.normpath(tf):
            fallos.append(f"encontró {found!r} en vez de {tf!r}")

        # Sin TF2 tiene que quejarse, no devolver una ruta inventada.
        empty = os.path.join(tmp, "Vacio")
        os.makedirs(os.path.join(empty, "steamapps"))
        try:
            import_tf2.find_tf2(empty)
            fallos.append("sin TF2 instalado debería avisar, no devolver una ruta")
        except SystemExit:
            pass

    # Los nueve arquetipos, con la asignación del original.
    if len(import_tf2.CLASS_BY_ARCHETYPE) != 9:
        fallos.append("faltan arquetipos en el reparto")
    if len(set(import_tf2.CLASS_BY_ARCHETYPE.values())) != 9:
        fallos.append("dos arquetipos comparten clase de TF2: serían indistinguibles")
    if import_tf2.CLASS_BY_ARCHETYPE.get("captain") != "soldier":
        fallos.append("el capitán llevaba la skin del soldier en 2012")

    for f in fallos:
        print("FALLO:", f)
    print("OK" if not fallos else f"{len(fallos)} fallos")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
