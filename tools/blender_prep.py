# Decimate a heavy GLB (or convert + decimate an FBX) down to a triangle budget (dev-time only).
#   blender -b --python blender_prep.py -- in.glb|in.fbx|in.blend out.glb <target_tris> [join] [weld] [keep=<min tris kept per mesh>]
# join: merge every mesh into one object per material set first (needed for sculpts split into chunks)
# weld: merge duplicate vertices first (unindexed scans decimate badly otherwise)
import bpy, sys

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, target = argv[0], argv[1], int(argv[2])
opts = argv[3:]
keep = next((int(o[5:]) for o in opts if o.startswith('keep=')), 600)

bpy.ops.wm.read_factory_settings(use_empty=True)
if src.lower().endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=src)
elif src.lower().endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']

def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)

def only(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

if 'join' in opts and len(meshes) > 1:
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    meshes = [meshes[0]]

if 'weld' in opts:
    for o in meshes:
        only(o)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=1e-5)
        bpy.ops.object.mode_set(mode='OBJECT')
        bpy.ops.object.shade_smooth()

total = sum(tris(o) for o in meshes)
ratio = min(1.0, target / max(total, 1))
print('PREP total tris', total, 'ratio', round(ratio, 4))
for o in meshes:
    n = tris(o)
    r = max(ratio, min(1.0, keep / max(n, 1)))
    if r >= 0.999:
        continue
    only(o)
    m = o.modifiers.new('dec', 'DECIMATE')
    m.ratio = r
    bpy.ops.object.modifier_apply(modifier='dec')
print('PREP result tris', sum(tris(o) for o in meshes), 'meshes', len(meshes))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_animations=True, export_skins=True, export_yup=True)
print('PREP wrote', dst)
