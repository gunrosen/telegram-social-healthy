class GroupAggregationByDay {
  numberActionChatAddUser: number = 0
  numberActionChatDeleteUser: number = 0
  numberActionChatJoinedByLink: number = 0
  numberActionChatJoinedByRequest: number = 0
  numberActionPinMessage: number = 0

  numberMessage: number = 0
  numberMessageByBot: number = 0
  numberMessageForwardFromChannel: number = 0

  numberMediaPhoto: number = 0
  numberMediaDocument: number = 0
  numberMediaPoll: number = 0
}

class ChannelAggregationByDay {
  numberViews : number = 0
  numberReaction : number = 0
  numberForward : number = 0
  numberReply : number = 0
}

export {
  GroupAggregationByDay,
  ChannelAggregationByDay
}