# LightlyShaders v3.0
 This is a fork of a-parhom's [LightlyShaders](https://github.com/a-parhom/LightlyShaders), which is in turn a fork of Luwx's [LightlyShaders](https://github.com/Luwx/LightlyShaders), which in turn is a fork of [ShapeCorners](https://sourceforge.net/projects/shapecorners/).  

 **It now also includes a fork of KWin Blur effect to fix the "korner bug".** It is disabled by default, you will have to enter Effects settings, disable the stock blur and enable the one with the "LightlyShaders" lable.

 This effect works correctly with stock Plasma effects.

 ![](./screenshot.png)

# Dependencies:

Plasma >= 6.8.

You will need qt6, kf6 and kwin development packages.

# Manual installation
```
git clone https://github.com/autumn-mck/LightlyShaders

cd LightlyShaders;

mkdir qt6build; cd qt6build; cmake ../ -DCMAKE_INSTALL_PREFIX=/usr && make && sudo make install
```

## Note
After most/all updates of Plasma this plugin will need to be recompiled in order to work with changes introduced to KWin.
