import os

app_path = os.path.abspath("build/Super DeepSeek.app")
background_path = os.path.abspath("dmg-background.png")

volume_name = "Super DeepSeek"
format = "UDZO"
compression_level = 9

files = [app_path]
symlinks = {"Applications": "/Applications"}

background = background_path
window_rect = ((220, 180), (660, 400))
default_view = "icon-view"
icon_size = 128
text_size = 14

icon_locations = {
    "Super DeepSeek.app": (170, 190),
    "Applications": (490, 190),
}

show_status_bar = False
show_tab_view = False
show_pathbar = False
show_sidebar = False
