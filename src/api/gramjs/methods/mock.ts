export async function mockInvoke(request:any){

    console.log(request.className);

    switch(request.className){

        case "messages.GetDialogs":
            return dialogsMock;

        case "messages.GetHistory":
            return historyMock;

        case "users.GetFullUser":
            return currentUserMock;

        default:
            return {};
    }

}