export const devices = [
 {id:'iphone-15-pro',name:'iPhone 15 Pro',width:393,height:852,status:59,bottom:34,shape:'island',radius:46},
 {id:'iphone-13',name:'iPhone 13',width:390,height:844,status:47,bottom:34,shape:'notch',radius:44},
 {id:'iphone-se',name:'iPhone SE',width:375,height:667,status:20,bottom:0,shape:'home',radius:3},
 {id:'pixel-9',name:'Pixel 9',width:412,height:915,status:32,bottom:24,shape:'hole',radius:32},
] as const
export type Device = typeof devices[number]
export function previewDevice(id:string) {const device=devices.find(item=>item.id===id);if(!device)throw Error('PREVIEW_DEVICE_NOT_FOUND');return device}
export function windowInfo(device:Device,custom=false,tabBar=false) {
 const top=device.status+(custom?0:44),bottom=device.height-device.bottom-(tabBar?50:0)
 return {pixelRatio:1,screenWidth:device.width,screenHeight:device.height,windowWidth:device.width,windowHeight:bottom-top,screenTop:top,statusBarHeight:device.status,safeArea:{left:0,top:device.status,right:device.width,bottom:device.height-device.bottom,width:device.width,height:device.height-device.status-device.bottom}}
}
export function menuButtonRect(device:Device) {return {width:87,height:32,top:device.status+6,bottom:device.status+38,left:device.width-94,right:device.width-7}}
