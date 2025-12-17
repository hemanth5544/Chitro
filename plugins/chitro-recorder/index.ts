import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MotiaPlugin, MotiaPluginContext } from 'motia'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function chitroRecorderPlugin(_motia: MotiaPluginContext): MotiaPlugin {
  return {
    dirname: path.join(__dirname, '../..'),
    workbench: [
      {
        componentName: 'ChitroRecorder',
        packageName: '~/plugins/chitro-recorder/components/chitro-recorder',
        label: 'Chitro Recorder',
        position: 'top',
        labelIcon: 'video',
      },
    ],
  }
}

export default chitroRecorderPlugin

