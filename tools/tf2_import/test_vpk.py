"""Prueba del lector de VPK contra un archivo construido a mano.

No hace falta tener TF2 para comprobar que el lector entiende el formato: se
fabrica un VPK mínimo con casos que son justo donde se falla —datos en el
propio `_dir.vpk`, datos en un archivo aparte, y un fichero que cabe entero en
la zona de `preload`— y se comprueba que salen los bytes exactos.
"""

import os
import struct
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vpk import Vpk, IN_DIR_FILE  # noqa: E402


def _entry(crc, preload, archive, offset, length):
    return struct.pack("<IHHIIH", crc, len(preload), archive, offset, length, 0xFFFF) + preload


def _build(tmp):
    en_dir = b"datos dentro del _dir"
    aparte = b"datos en el archivo 000"
    incrustado = b"cabe en preload"

    tree = b""
    tree += b"mdl\x00"
    tree += b"models/player\x00"
    tree += b"scout\x00" + _entry(1, b"", IN_DIR_FILE, 0, len(en_dir))
    tree += b"soldier\x00" + _entry(2, b"", 0, 0, len(aparte))
    tree += b"spy\x00" + _entry(3, incrustado, 0, 0, 0)
    tree += b"\x00"   # fin de nombres
    tree += b"\x00"   # fin de rutas
    tree += b"\x00"   # fin de extensiones

    dir_path = os.path.join(tmp, "pak01_dir.vpk")
    with open(dir_path, "wb") as handle:
        handle.write(struct.pack("<III", 0x55AA1234, 2, len(tree)))
        handle.write(struct.pack("<IIII", 0, 0, 0, 0))
        handle.write(tree)
        handle.write(en_dir)
    with open(os.path.join(tmp, "pak01_000.vpk"), "wb") as handle:
        handle.write(aparte)
    return dir_path, en_dir, aparte, incrustado


def main() -> int:
    fallos = []
    with tempfile.TemporaryDirectory() as tmp:
        dir_path, en_dir, aparte, incrustado = _build(tmp)
        vpk = Vpk(dir_path)

        if len(vpk) != 3:
            fallos.append(f"se esperaban 3 entradas, hay {len(vpk)}")
        if "models/player/scout.mdl" not in vpk:
            fallos.append("no encuentra scout.mdl")
        if vpk.read("models/player/scout.mdl") != en_dir:
            fallos.append("mal los datos guardados dentro del _dir.vpk")
        if vpk.read("models/player/soldier.mdl") != aparte:
            fallos.append("mal los datos guardados en un archivo aparte")
        if vpk.read("MODELS/Player/Spy.MDL") != incrustado:
            fallos.append("mal el preload, o la busqueda distingue mayusculas")
        try:
            vpk.read("models/player/pyro.mdl")
            fallos.append("un fichero inexistente deberia dar KeyError")
        except KeyError:
            pass

    for f in fallos:
        print("FALLO:", f)
    print("OK" if not fallos else f"{len(fallos)} fallos")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
