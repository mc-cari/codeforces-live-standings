export default function Position ({position, userCount} : {position : number, userCount : number})  {

  let bgPosition = ''

  if(position / userCount < 0.1 || position === 1)
    bgPosition = 'bg-yellow-500'
  else if(position / userCount < 0.25 || position === 2)
    bgPosition = 'bg-gray-500'
  else if(position / userCount < 0.5 || position === 3)
    bgPosition = 'bg-yellow-800'

  return (
    <div className={`h-full flex items-center justify-center ${bgPosition}`}>
      {position}
    </div>
  )

}