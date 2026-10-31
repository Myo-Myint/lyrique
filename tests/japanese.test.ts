import { describe, expect, it } from 'vitest'
import { romanizeJapanese } from '../src/main/japanese'

describe('romanizeJapanese', () => {
  it.each([
    ['誰も彼も虜にしていく', 'Dare mo kare mo toriko ni shite iku'],
    ['嘘でもそれは完全なアイ', 'Uso de mo sore wa kanzen na ai'],
    ['君の名前を呼んだ', 'Kimi no namae o yonda'],
    ['夢を見てた、ずっと', 'Yume o miteta, zutto'],
    ['I love you 愛してる', 'I love you aishiteru'],
    ['ねえ、ちょっと待って！', 'Nee, chotto matte!'],
    ['僕は君が好きだった', 'Boku wa kimi ga suki datta'],
    ['無敵の笑顔で荒らすメディア', 'Muteki no egao de arasu media'],
    ['天才的なアイドル様', 'Tensaiteki na aidoru-sama']
  ])('%s → %s', async (ja, rom) => expect((await romanizeJapanese([ja]))[0]).toBe(rom))

  it('leaves lines without Japanese alone', async () => expect(await romanizeJapanese(['Hello there', ''])).toEqual([null, null]))
})
